import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE } from "../../../../lib/auth";
import {
  fetchAgronomicCase,
  generateAgronomicPreAnalysis,
  getAuthenticatedUser,
  updateAgronomicCaseWithAnalysis,
  insertCaseChatMessage,
  replaceCasePendingQuestions,
  answerCurrentPendingQuestion,
  fetchCasePendingQuestions,
  getCurrentPendingQuestion,
  logPendingQuestionSync,
  syncAnalysisMissingQuestionsWithPendingQueue,
} from "../../../../lib/agronomic/case";
import {
  PLAN_LIMIT_REACHED_MESSAGE,
  PlanLimitExceededError,
  assertPlanLimit,
  recordQuestionHistory,
  recordUsageEvent,
} from "../../../../lib/billing/check-plan-limits";
import type { UsageEventType } from "../../../../lib/billing/check-plan-limits";
import type { AgronomicPreAnalysis } from "../../../../lib/agronomic/case";
import {
  ANALYSIS_BUDGET_MS,
  AgronomicAnalysisError,
  loadAnalysisImages,
  summarizeAnalysisImages,
  type AnalysisImagesResult,
} from "../../../../lib/agronomic/case-analysis";
import { CASE_STORAGE_BUCKET } from "../../../../lib/agronomic/case-attachments";
import type { AgronomicAnalysisRunInfo } from "../../../../src/lib/ai/orchestrator/analyze-case";

const RECENT_ANALYSIS_WINDOW_MS = 30_000;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Referência curta para suporte (sem dados do usuário). */
function requestReference(request: NextRequest) {
  const vercelId = request.headers.get("x-vercel-id");
  const tail = vercelId?.split("::").pop();
  return (tail || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).slice(-24);
}

/**
 * Casos com análise em andamento nesta instância. Cliques repetidos ou duas
 * abas no mesmo caso não disparam uma segunda chamada paga à IA enquanto a
 * primeira não termina (complementa a janela de 30 s após gravar).
 */
const inFlightAnalyses = new Set<string>();

function logAnalysis(event: string, data: Record<string, unknown>) {
  // Somente metadados: nunca URLs, base64, textos do caso ou credenciais.
  console.info(`[analyze-case] ${event}`, JSON.stringify(data));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + ANALYSIS_BUDGET_MS;
  const requestId = requestReference(request);
  let logCaseId: string | null = null;
  try {
    const token =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      request.cookies.get(AUTH_ACCESS_COOKIE)?.value ||
      "";

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para gerar a pré-análise do caso." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token);

    const payload = (await request.json().catch(() => ({}))) as {
      caseId?: string;
      question?: string;
    };
    const caseId = payload.caseId?.trim();
    logCaseId = caseId ?? null;

    if (!caseId) {
      return NextResponse.json(
        { error: "Informe o caseId para gerar a pré-análise." },
        { status: 400 },
      );
    }

    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData) {
      return NextResponse.json(
        { error: "Caso não encontrado ou sem permissão de acesso." },
        { status: 404 },
      );
    }

    if (caseData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Este caseId não pertence ao usuário autenticado." },
        { status: 403 },
      );
    }

    const question = payload.question?.trim();
    const usageEventType: UsageEventType = question
      ? "ai_question"
      : "case_analysis";

    // Proteção contra disparo repetido (duplo clique, duas abas): uma análise
    // gravada há poucos segundos é devolvida sem chamar a IA nem consumir crédito.
    const lastAnalyzedAt = caseData.ai_analysis_json?.analyzedAt
      ? new Date(caseData.ai_analysis_json.analyzedAt).getTime()
      : 0;
    if (!question && caseData.ai_analysis_json && Date.now() - lastAnalyzedAt < RECENT_ANALYSIS_WINDOW_MS) {
      return NextResponse.json({
        analysis: caseData.ai_analysis_json,
        sourceMetadata: caseData.ai_analysis_json.sourceMetadata,
        deduplicated: true,
      });
    }

    await assertPlanLimit(user.id, usageEventType);

    const flightKey = `${caseId}:${question ? "q" : "a"}`;
    if (inFlightAnalyses.has(flightKey)) {
      return NextResponse.json(
        {
          error: "A análise deste caso já está sendo gerada. Aguarde alguns segundos e atualize a página.",
          code: "ANALYSIS_IN_PROGRESS",
          requestId,
          retryable: true,
        },
        { status: 409 },
      );
    }
    inFlightAnalyses.add(flightKey);
    try {
      let answeredPendingQuestion = null;
      let nextPendingQuestion = null;

      if (question) {
        await insertCaseChatMessage(
          { caseId, userId: user.id, role: "user", message: question },
          token,
        ).catch((error) =>
          console.warn(
            "Não foi possível salvar mensagem do usuário no chat do caso.",
            error,
          ),
        );

        const pendingState = await answerCurrentPendingQuestion(
          caseId,
          question,
          token,
        ).catch((error) => {
          console.warn(
            "Não foi possível atualizar a pergunta pendente do caso.",
            error,
          );
          return { answered: null, next: null };
        });
        answeredPendingQuestion = pendingState.answered;
        nextPendingQuestion = pendingState.next;
      }

      const officialQuestionsBeforeModel = question
        ? await fetchCasePendingQuestions(caseId, token).catch(() => [])
        : [];
      const pendingCountBeforeModel = officialQuestionsBeforeModel.filter(
        (item) => item.status === "pending",
      ).length;
      const modelQuestion = question
        ? [
            question,
            `Estado oficial da fila no banco: pendingQuestions.length === ${pendingCountBeforeModel}. Perguntas pendentes oficiais restantes: ${pendingCountBeforeModel}.`,
            "Se pendingQuestions.length === 0, não gere novas missingQuestions; conclua a triagem com limitação natural se necessário.",
          ].join("\n")
        : question;

      // As fotos são carregadas no servidor, do storage do próprio caso (pasta do
      // usuário), e enviadas ao modelo como imagem. Upload e vínculo já terminaram:
      // o caso só existe com as fotos depois que POST /api/agronomic-cases conclui.
      const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
      const runInfo: AgronomicAnalysisRunInfo = { images: null };
      const prepareImages = (): Promise<AnalysisImagesResult> =>
        loadAnalysisImages({
          images: caseData.images ?? [],
          userId: user.id,
          caseId,
          allowedPrefix: `${supabaseUrl}/storage/v1/object/public/${CASE_STORAGE_BUCKET}/`,
        });

      const modelAnalysis = await generateAgronomicPreAnalysis(
        caseData,
        modelQuestion,
        token,
        { deadlineAt, prepareImages, allowLocalFallback: false },
        runInfo,
      );
      const imageAnalysis = summarizeAnalysisImages(runInfo.images);
      logAnalysis("model_completed", {
        requestId,
        caseId,
        durationMs: Date.now() - startedAt,
        imagesTotal: imageAnalysis.total,
        imagesAnalyzed: imageAnalysis.analyzed,
        imagesUnavailable: imageAnalysis.unavailable.length,
      });
      let analysis: AgronomicPreAnalysis = { ...modelAnalysis, imageAnalysis };

      if (!question) {
        const pendingQuestions = await replaceCasePendingQuestions(
          caseId,
          modelAnalysis.missingQuestions,
          token,
        ).catch((error) => {
          console.warn(
            "Não foi possível salvar a fila de perguntas pendentes do caso.",
            error,
          );
          return [];
        });
        logPendingQuestionSync({
          scope: "agronomic-analyze-initial",
          aiMissingQuestions: modelAnalysis.missingQuestions,
          questions: pendingQuestions,
        });
        analysis = syncAnalysisMissingQuestionsWithPendingQueue(
          analysis,
          pendingQuestions,
        );
        analysis = await updateAgronomicCaseWithAnalysis(caseId, token, analysis, { source: "analysis" });
        await recordUsageEvent(user.id, usageEventType);
        const firstQuestion = getCurrentPendingQuestion(pendingQuestions);
        const intro =
          "Pré-análise gerada. Vou conduzir a consulta em etapas e fazer apenas uma pergunta pendente por vez.";

        await insertCaseChatMessage(
          { caseId, userId: user.id, role: "assistant", message: intro },
          token,
        ).catch(() => null);

        if (firstQuestion) {
          await insertCaseChatMessage(
            {
              caseId,
              userId: user.id,
              role: "assistant",
              message: firstQuestion.question,
            },
            token,
          ).catch(() => null);
        }

        return NextResponse.json({
          analysis,
          sourceMetadata: analysis.sourceMetadata,
          pendingQuestions,
          currentQuestion: firstQuestion,
          imageAnalysis,
          requestId,
        });
      }

      if (question) {
        const pendingQuestions = await fetchCasePendingQuestions(
          caseId,
          token,
        ).catch(() => []);
        logPendingQuestionSync({
          scope: "agronomic-analyze-follow-up",
          aiMissingQuestions: modelAnalysis.missingQuestions,
          questions: pendingQuestions,
        });
        analysis = syncAnalysisMissingQuestionsWithPendingQueue(
          analysis,
          pendingQuestions,
        );
        analysis = await updateAgronomicCaseWithAnalysis(caseId, token, analysis, { source: "chat" });
        await recordUsageEvent(user.id, usageEventType);
        nextPendingQuestion = getCurrentPendingQuestion(pendingQuestions);

        const assistantMessage = nextPendingQuestion
          ? `${
              analysis.conversationalAnswer?.trim() ||
              "Entendi. Vou avançar para a próxima pergunta para completar a triagem."
            }

  ${nextPendingQuestion.question}`
          : analysis.conversationalAnswer?.trim() ||
            "Com as informações fornecidas, a triagem inicial foi concluída. Ainda pode existir alguma incerteza natural devido às limitações da análise remota, mas no momento não há perguntas pendentes obrigatórias. " +
              (analysis.riskLevel === "medium" || analysis.riskLevel === "high"
                ? "Como há risco ou incerteza relevante, recomendo revisão humana antes de decisões de manejo importantes."
                : "Mantenha o monitoramento e solicite revisão humana se os sintomas evoluírem ou houver decisão de manejo relevante.");

        await insertCaseChatMessage(
          {
            caseId,
            userId: user.id,
            role: "assistant",
            message: assistantMessage,
          },
          token,
        ).catch((error) =>
          console.warn(
            "Não foi possível salvar resposta da IA no chat do caso.",
            error,
          ),
        );

        await recordQuestionHistory({
          userId: user.id,
          caseId,
          question,
          answer: assistantMessage,
          source: "agronomic_case",
        });

        return NextResponse.json({
          analysis: { ...analysis, conversationalAnswer: assistantMessage },
          sourceMetadata: analysis.sourceMetadata,
          answeredPendingQuestion,
          answeredQuestion: answeredPendingQuestion,
          currentQuestion: nextPendingQuestion,
          pendingQuestions,
        });
      }

      return NextResponse.json({ analysis, sourceMetadata: analysis.sourceMetadata });
    } finally {
      inFlightAnalyses.delete(flightKey);
    }
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json(
        { error: PLAN_LIMIT_REACHED_MESSAGE, code: "PLAN_LIMIT_REACHED", requestId },
        { status: error.status },
      );
    }

    // Falha real da IA (tempo esgotado, provedor fora do ar, resposta
    // inválida): nada é gravado nem cobrado; o caso, o texto e as fotos
    // continuam salvos e o usuário pode tentar de novo.
    if (error instanceof AgronomicAnalysisError) {
      logAnalysis("model_failed", { requestId, caseId: logCaseId, code: error.code, durationMs: Date.now() - startedAt });
      return NextResponse.json(
        { error: error.message, code: error.code, requestId, retryable: true },
        { status: error.status },
      );
    }

    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
    logAnalysis("request_failed", {
      requestId,
      caseId: logCaseId,
      status,
      errorName: error instanceof Error ? error.name : typeof error,
      durationMs: Date.now() - startedAt,
    });
    if (status === 401) {
      return NextResponse.json(
        { error: "Sua sessão expirou. Faça login novamente para gerar a análise.", code: "AUTH_REQUIRED", requestId },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "Não foi possível gerar a análise agora. Seus dados e fotos continuam salvos no caso. Tente novamente em instantes.",
        code: "ANALYSIS_FAILED",
        requestId,
        retryable: true,
      },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}

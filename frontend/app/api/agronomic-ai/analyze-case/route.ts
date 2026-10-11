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
  ANALYSIS_SYNC_RESEARCH_CAP_MS,
  AgronomicAnalysisError,
  loadAnalysisImages,
  summarizeAnalysisImages,
  type AnalysisImagesResult,
} from "../../../../lib/agronomic/case-analysis";
import { CASE_STORAGE_BUCKET } from "../../../../lib/agronomic/case-attachments";
import {
  ANALYSIS_MAX_OUTPUT_TOKENS,
  completeAgronomicAnalysis,
  logBackgroundAnalysisUsage,
  prepareAgronomicAnalysis,
  selectBackgroundAnalysisModel,
  type AgronomicAnalysisRunInfo,
} from "../../../../src/lib/ai/orchestrator/analyze-case";
import {
  cancelBackgroundResponse,
  getBackgroundResponse,
  startBackgroundResponse,
} from "../../../../src/lib/ai/providers/openai";
import { geminiProvider, getGeminiModel } from "../../../../src/lib/ai/providers/gemini";
import {
  AnalysisJobStoreUnavailableError,
  createSupabaseAnalysisJobStore,
} from "../../../../lib/server/analysis-jobs";
import {
  pollCaseAnalysis,
  startCaseAnalysis,
  type AnalysisJobView,
  type AnalysisServiceDeps,
} from "../../../../lib/server/case-analysis-service";
import type { AgronomicCase } from "../../../../lib/agronomic/case";

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

/** Tempos por etapa do fluxo síncrono, sem conteúdo do caso. */
function syncStages(runInfo: AgronomicAnalysisRunInfo | null) {
  if (!runInfo) return {};
  return {
    researchMs: runInfo.researchMs ?? null,
    researchBudgetMs: runInfo.researchBudgetMs ?? null,
    internetResearch: runInfo.internetResearchStatus ?? null,
    imagesLoaded: runInfo.images?.loaded.length ?? 0,
    imagesUnavailable: runInfo.images?.unavailable.length ?? 0,
    attempts: (runInfo.attempts ?? []).map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      fallback: attempt.isFallback,
      timeoutMs: attempt.timeoutMs,
      ms: attempt.durationMs,
      outcome: attempt.outcome,
    })),
  };
}

function readToken(request: NextRequest) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.cookies.get(AUTH_ACCESS_COOKIE)?.value ||
    ""
  );
}

function storageImagePrefix() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${supabaseUrl}/storage/v1/object/public/${CASE_STORAGE_BUCKET}/`;
}

/**
 * Grava a análise inicial no caso: fila oficial de perguntas, análise e
 * histórico, uso do plano e mensagens de abertura do chat. Lança se a
 * gravação da análise falhar (nada é dado como concluído sem isso).
 */
async function persistInitialAnalysis(input: {
  caseId: string;
  userId: string;
  token: string;
  analysis: AgronomicPreAnalysis;
}) {
  const { caseId, userId, token } = input;
  const pendingQuestions = await replaceCasePendingQuestions(
    caseId,
    input.analysis.missingQuestions,
    token,
  ).catch((error) => {
    console.warn("Não foi possível salvar a fila de perguntas pendentes do caso.", error instanceof Error ? error.name : error);
    return [];
  });
  logPendingQuestionSync({
    scope: "agronomic-analyze-initial",
    aiMissingQuestions: input.analysis.missingQuestions,
    questions: pendingQuestions,
  });
  let analysis = syncAnalysisMissingQuestionsWithPendingQueue(input.analysis, pendingQuestions);
  try {
    analysis = await updateAgronomicCaseWithAnalysis(caseId, token, analysis, { source: "analysis" });
  } catch (error) {
    // Falha de gravação é diferente de falha da IA: a tela recebe SAVE_FAILED.
    console.warn("[analyze-case] save_failed", JSON.stringify({ caseId, errorName: error instanceof Error ? error.name : typeof error, status: (error as { status?: number })?.status ?? null }));
    throw new AgronomicAnalysisError("SAVE_FAILED");
  }
  await recordUsageEvent(userId, "case_analysis");
  const firstQuestion = getCurrentPendingQuestion(pendingQuestions);
  await insertCaseChatMessage(
    {
      caseId,
      userId,
      role: "assistant",
      message: "Pré-análise gerada. Vou conduzir a consulta em etapas e fazer apenas uma pergunta pendente por vez.",
    },
    token,
  ).catch(() => null);
  if (firstQuestion) {
    await insertCaseChatMessage(
      { caseId, userId, role: "assistant", message: firstQuestion.question },
      token,
    ).catch(() => null);
  }
  return { analysis, pendingQuestions, firstQuestion };
}

function buildServiceDeps(input: { caseData: AgronomicCase; userId: string; token: string }): AnalysisServiceDeps {
  return {
    store: createSupabaseAnalysisJobStore(),
    background: process.env.OPENAI_API_KEY
      ? {
          start: (messages, options) => startBackgroundResponse(messages, options),
          get: (id, options) => getBackgroundResponse(id, options),
          cancel: (id) => cancelBackgroundResponse(id),
        }
      : null,
    complete: (content, context) => completeAgronomicAnalysis(content, context, input.caseData),
    persist: (analysis) =>
      persistInitialAnalysis({ caseId: input.caseData.id, userId: input.userId, token: input.token, analysis }),
    logUsage: (usage) => logBackgroundAnalysisUsage({ userId: input.userId, ...usage }),
    log: logAnalysis,
  };
}

/** Resposta pública de um job (sem contexto interno, URLs ou ids do provedor). */
function jobResponse(view: AnalysisJobView & { providerCheckFailed?: boolean }, extra: Record<string, unknown> = {}) {
  if (view.state === "idle") return NextResponse.json({ status: "idle", ...extra });
  const job = view.job;
  const body: Record<string, unknown> = {
    status: view.state,
    jobId: job.id,
    requestId: job.request_id,
    startedAt: job.started_at,
    elapsedMs: Math.max(0, Date.now() - Date.parse(job.started_at)),
    imageAnalysis: job.image_summary ?? null,
    finishedAt: job.completed_at,
    ...extra,
  };
  if (view.state === "failed") {
    return NextResponse.json(
      { ...body, error: view.message, code: view.code, retryable: view.retryable },
      { status: view.code === "AI_TIMEOUT" ? 504 : view.code === "SAVE_FAILED" ? 500 : 503 },
    );
  }
  if (view.state === "completed") {
    return NextResponse.json({ ...body, ...(view.analysis ? { analysis: view.analysis } : {}) });
  }
  if ("reused" in view && view.reused) body.reused = true;
  if (view.providerCheckFailed) body.providerCheckFailed = true;
  return NextResponse.json(body, { status: 202 });
}

/**
 * GET ?caseId=…  Andamento da análise inicial. Valida sessão e propriedade do
 * caso; quando a resposta do provedor já está pronta, grava no caso aqui.
 */
export async function GET(request: NextRequest) {
  const requestId = requestReference(request);
  const startedAt = Date.now();
  const caseId = request.nextUrl.searchParams.get("caseId")?.trim() ?? "";
  try {
    const token = readToken(request);
    if (!token) {
      return NextResponse.json({ error: "Faça login para acompanhar a análise.", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (!caseId) {
      return NextResponse.json({ error: "Informe o caseId." }, { status: 400 });
    }
    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(caseId, token);
    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }
    const view = await pollCaseAnalysis({ caseId, userId: user.id, deps: buildServiceDeps({ caseData, userId: user.id, token }) });
    // Loga mudanças de estado e, durante o processamento, ~1 vez a cada 30 s.
    if (view.state !== "processing" || view.providerCheckFailed || (Date.now() - Date.parse(view.job.started_at)) % 30_000 < 5_000) {
      logAnalysis("poll", { requestId, caseId, state: view.state, jobId: view.state === "idle" ? null : view.job.id, jobRequestId: view.state === "idle" ? null : view.job.request_id, ms: Date.now() - startedAt });
    }
    return jobResponse(view);
  } catch (error) {
    if (error instanceof AnalysisJobStoreUnavailableError) {
      return NextResponse.json({ status: "unsupported" });
    }
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
    logAnalysis("poll_failed", { requestId, caseId, status, errorName: error instanceof Error ? error.name : typeof error });
    if (status === 401) {
      return NextResponse.json({ error: "Sua sessão expirou. Faça login novamente.", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Não foi possível consultar o andamento da análise agora.", code: "STATUS_UNAVAILABLE", requestId, retryable: true },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + ANALYSIS_BUDGET_MS;
  const requestId = requestReference(request);
  let logCaseId: string | null = null;
  let syncRunInfo: AgronomicAnalysisRunInfo | null = null;
  try {
    const token = readToken(request);

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

    // Análise inicial: processamento durável (job + modo background do
    // provedor). Sem a migration dos jobs, segue o fluxo síncrono abaixo.
    if (!question) {
      try {
        const deps = buildServiceDeps({ caseData, userId: user.id, token });
        const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? { provider: geminiProvider, model: getGeminiModel() } : null;
        const view = await startCaseAnalysis({
          caseId,
          userId: user.id,
          requestId,
          deadlineAt,
          maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
          selectModel: selectBackgroundAnalysisModel,
          syncFallback: gemini,
          prepare: () =>
            prepareAgronomicAnalysis(caseData, {
              enableKnowledgeSearch: true,
              deadlineAt,
              // Fotos reais em resolução alta: lesões pequenas importam no diagnóstico.
              imageDetail: "high",
              prepareImages: () =>
                loadAnalysisImages({ images: caseData.images ?? [], userId: user.id, caseId, allowedPrefix: storageImagePrefix() }),
            }),
          deps,
        });
        logAnalysis("start", {
          requestId,
          caseId,
          state: view.state,
          jobId: view.state === "idle" ? null : view.job.id,
          reused: "reused" in view ? Boolean(view.reused) : false,
          ms: Date.now() - startedAt,
        });
        return jobResponse(view);
      } catch (error) {
        if (!(error instanceof AnalysisJobStoreUnavailableError)) throw error;
        logAnalysis("jobs_unavailable_sync_fallback", { requestId, caseId, reason: error.reason, dbCode: error.dbCode });
        // Configuração incompleta do ambiente: sem a tabela, a análise fica
        // presa ao limite de 60 s da função e sem bloqueio entre instâncias.
        console.error(
          "[analyze-case] Processamento durável desativado: aplique a migration 20261010120000_agronomic_analysis_jobs.sql.",
          JSON.stringify({ requestId, reason: error.reason, dbCode: error.dbCode }),
        );
      }
    }

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
      syncRunInfo = runInfo;
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
        {
          deadlineAt,
          prepareImages,
          allowLocalFallback: false,
          // A mesma requisição ainda espera a IA: a pesquisa tem teto menor.
          researchCapMs: ANALYSIS_SYNC_RESEARCH_CAP_MS,
        },
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
        ...syncStages(runInfo),
      });
      let analysis: AgronomicPreAnalysis = { ...modelAnalysis, imageAnalysis };

      if (!question) {
        const saved = await persistInitialAnalysis({ caseId, userId: user.id, token, analysis });
        return NextResponse.json({
          analysis: saved.analysis,
          sourceMetadata: saved.analysis.sourceMetadata,
          pendingQuestions: saved.pendingQuestions,
          currentQuestion: saved.firstQuestion,
          imageAnalysis,
          requestId,
          status: "completed",
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
      logAnalysis("model_failed", { requestId, caseId: logCaseId, code: error.code, durationMs: Date.now() - startedAt, ...syncStages(syncRunInfo) });
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

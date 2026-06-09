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

export async function POST(request: NextRequest) {
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

    const payload = (await request.json()) as {
      caseId?: string;
      question?: string;
    };
    const caseId = payload.caseId?.trim();

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

    await assertPlanLimit(user.id, usageEventType);

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

    const modelAnalysis = await generateAgronomicPreAnalysis(
      caseData,
      modelQuestion,
      token,
    );
    let analysis = modelAnalysis;

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
        modelAnalysis,
        pendingQuestions,
      );
      await updateAgronomicCaseWithAnalysis(caseId, token, analysis);
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
        pendingQuestions,
        currentQuestion: firstQuestion,
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
        modelAnalysis,
        pendingQuestions,
      );
      await updateAgronomicCaseWithAnalysis(caseId, token, analysis);
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
        answeredPendingQuestion,
        answeredQuestion: answeredPendingQuestion,
        currentQuestion: nextPendingQuestion,
        pendingQuestions,
      });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json(
        { error: PLAN_LIMIT_REACHED_MESSAGE },
        { status: error.status },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível gerar a pré-análise agronômica.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

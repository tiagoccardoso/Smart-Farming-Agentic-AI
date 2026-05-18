import { NextRequest, NextResponse } from "next/server";
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
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");

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

    const analysis = await generateAgronomicPreAnalysis(
      caseData,
      question,
      token,
    );
    await updateAgronomicCaseWithAnalysis(caseId, token, analysis);
    await recordUsageEvent(user.id, usageEventType);

    if (!question) {
      const pendingQuestions = await replaceCasePendingQuestions(
        caseId,
        analysis.missingQuestions,
        token,
      ).catch((error) => {
        console.warn(
          "Não foi possível salvar a fila de perguntas pendentes do caso.",
          error,
        );
        return [];
      });
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
      if (!nextPendingQuestion) {
        const pendingQuestions = await fetchCasePendingQuestions(
          caseId,
          token,
        ).catch(() => []);
        nextPendingQuestion = getCurrentPendingQuestion(pendingQuestions);
      }

      const assistantMessage = nextPendingQuestion
        ? `${
            analysis.conversationalAnswer?.trim() ||
            "Entendi. Vou avançar para a próxima pergunta para completar a triagem."
          }

${nextPendingQuestion.question}`
        : (analysis.conversationalAnswer ??
          "Obrigado. Com as respostas registradas, mantenha o monitoramento e solicite revisão humana se houver risco, perdas ou decisão de manejo relevante.");

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
        currentQuestion: nextPendingQuestion,
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

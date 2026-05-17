import { NextResponse } from "next/server";
import { extractBearerToken, getCurrentUser } from "../../../lib/auth";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, assertPlanLimit, getQuestionHistory, recordQuestionHistory, recordUsageEvent } from "../../../lib/billing/check-plan-limits";
import { answerQuestion } from "../../../lib/qa/search";

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));

    if (!token) {
      return NextResponse.json({ success: false, error: "Faça login para usar perguntas com IA." }, { status: 401 });
    }

    const user = await getCurrentUser(token);
    const payload = (await request.json()) as { question?: string };
    const question = payload.question?.trim() ?? "";

    if (question.length < 3) {
      return NextResponse.json({ success: false, error: "A pergunta deve ter pelo menos 3 caracteres." }, { status: 400 });
    }

    await assertPlanLimit(user.id, "ai_question");

    const result = answerQuestion(question);
    await recordUsageEvent(user.id, "ai_question");
    await recordQuestionHistory({
      userId: user.id,
      question,
      answer: result.answer,
      source: "qa"
    });

    return NextResponse.json({
      success: true,
      question,
      ...result
    });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ success: false, error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    return NextResponse.json({ success: false, error: "Não foi possível responder à pergunta." }, { status: 500 });
  }
}


export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));

    if (!token) {
      return NextResponse.json({ success: false, error: "Faça login para ver seu histórico de perguntas." }, { status: 401 });
    }

    const user = await getCurrentUser(token);
    const history = await getQuestionHistory(user.id, "qa", 25);

    return NextResponse.json({ success: true, history });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Não foi possível carregar o histórico de perguntas." }, { status: 500 });
  }
}

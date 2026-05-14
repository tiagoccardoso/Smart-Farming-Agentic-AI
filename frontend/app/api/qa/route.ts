import { NextResponse } from "next/server";
import { answerQuestion } from "../../../lib/qa/search";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { question?: string };
    const question = payload.question?.trim() ?? "";

    if (question.length < 3) {
      return NextResponse.json({ success: false, error: "A pergunta deve ter pelo menos 3 caracteres." }, { status: 400 });
    }

    const result = answerQuestion(question);

    return NextResponse.json({
      success: true,
      question,
      ...result
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Não foi possível responder à pergunta." }, { status: 500 });
  }
}

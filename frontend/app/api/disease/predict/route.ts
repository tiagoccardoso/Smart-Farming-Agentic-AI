import { NextResponse } from "next/server";
import { extractBearerToken, getCurrentUser } from "../../../../lib/auth";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, assertPlanLimit, recordUsageEvent } from "../../../../lib/billing/check-plan-limits";
import { analyzeLeafImage } from "../../../../lib/disease/analyze";

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));

    if (!token) {
      return NextResponse.json({ success: false, error: "Faça login para usar a triagem por imagem." }, { status: 401 });
    }

    const user = await getCurrentUser(token);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Envie uma imagem de folha." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "O arquivo precisa ser uma imagem." }, { status: 400 });
    }

    await assertPlanLimit(user.id, "image_triage");

    const result = analyzeLeafImage(file.name, file.size);
    await recordUsageEvent(user.id, "image_triage");

    return NextResponse.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ success: false, error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    return NextResponse.json({ success: false, error: "Não foi possível analisar a imagem." }, { status: 500 });
  }
}

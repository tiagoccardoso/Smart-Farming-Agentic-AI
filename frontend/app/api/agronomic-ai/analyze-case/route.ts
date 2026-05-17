import { NextRequest, NextResponse } from "next/server";
import {
  fetchAgronomicCase,
  generateAgronomicPreAnalysis,
  getAuthenticatedUser,
  updateAgronomicCaseWithAnalysis
} from "../../../../lib/agronomic/case";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, assertPlanLimit, recordUsageEvent } from "../../../../lib/billing/check-plan-limits";

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para gerar a pré-análise do caso." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);

    const payload = (await request.json()) as { caseId?: string; question?: string };
    const caseId = payload.caseId?.trim();

    if (!caseId) {
      return NextResponse.json({ error: "Informe o caseId para gerar a pré-análise." }, { status: 400 });
    }

    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }

    if (caseData.user_id !== user.id) {
      return NextResponse.json({ error: "Este caseId não pertence ao usuário autenticado." }, { status: 403 });
    }

    await assertPlanLimit(user.id, "case_analysis");

    const analysis = await generateAgronomicPreAnalysis(caseData, payload.question, token);
    await updateAgronomicCaseWithAnalysis(caseId, token, analysis);
    await recordUsageEvent(user.id, "case_analysis");

    return NextResponse.json(analysis);
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Não foi possível gerar a pré-análise agronômica.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

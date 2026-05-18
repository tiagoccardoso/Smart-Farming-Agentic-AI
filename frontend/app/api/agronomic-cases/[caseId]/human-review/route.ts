import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../../lib/agronomic/case";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, assertPlanLimit, recordUsageEvent } from "../../../../../lib/billing/check-plan-limits";

async function logActivity(caseId: string, userId: string, token: string) {
  await supabaseRequest(
    "/rest/v1/case_activity_logs",
    { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: caseId, user_id: userId, action: "Revisão humana solicitada", metadata: { source: "consultoria-ia" } }) },
    token,
  ).catch(() => null);
}

export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para solicitar revisão humana." }, { status: 401 });
    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(params.caseId, token);
    if (!caseData) return NextResponse.json({ error: "Caso não encontrado ou sem permissão." }, { status: 404 });
    if (caseData.user_id !== user.id) return NextResponse.json({ error: "Você só pode solicitar revisão para seus próprios casos." }, { status: 403 });

    await assertPlanLimit(user.id, "human_review");
    const config = getSupabaseConfig();
    await supabaseRequest(
      "/rest/v1/human_reviews",
      { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: params.caseId, status: "waiting_review" }) },
      token,
      config,
    ).catch(async () => {
      await supabaseRequest(
        "/rest/v1/human_reviews",
        { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: params.caseId, status: "pending" }) },
        token,
        config,
      );
    });
    await supabaseRequest(
      `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(params.caseId)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ human_review_requested: true, human_review_status: "waiting_review", status: "waiting_human_review" }) },
      token,
      config,
    );
    await recordUsageEvent(user.id, "human_review").catch(() => null);
    await logActivity(params.caseId, user.id, token);
    return NextResponse.json({ ok: true, status: "waiting_human_review" });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ error: PLAN_LIMIT_REACHED_MESSAGE, offers: [{ label: "Revisão avulsa", price: 19700 }, { label: "Premium mensal", price: 39700 }] }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Não foi possível solicitar revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

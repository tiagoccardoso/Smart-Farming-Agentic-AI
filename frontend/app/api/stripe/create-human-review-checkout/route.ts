import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, UsageEventType, assertPlanLimit, recordUsageEvent } from "../../../../lib/billing/check-plan-limits";
import { HUMAN_REVIEW_SERVICES, createStripeCheckoutSession, isHumanReviewServiceType } from "../../../../lib/stripe/humanReview";

type CreateCheckoutPayload = {
  caseId?: string;
  serviceType?: string;
};

type CreatedOrder = {
  id: string;
};

function getUsageEventForServiceType(serviceType: string): UsageEventType | null {
  if (serviceType === "human_case_review") {
    return "human_review";
  }

  if (serviceType === "technical_report") {
    return "pdf_report";
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para solicitar a revisão humana." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as CreateCheckoutPayload | null;
    const caseId = payload?.caseId?.trim();
    const serviceType = payload?.serviceType?.trim();

    if (!caseId) {
      return NextResponse.json({ error: "Informe o caseId para solicitar revisão humana." }, { status: 400 });
    }

    if (!isHumanReviewServiceType(serviceType)) {
      return NextResponse.json({ error: "Informe um serviceType válido para o checkout." }, { status: 400 });
    }

    const [user, caseData] = await Promise.all([getAuthenticatedUser(token), fetchAgronomicCase(caseId, token)]);

    if (!caseData) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }

    if (caseData.user_id !== user.id) {
      return NextResponse.json({ error: "Este caseId não pertence ao usuário autenticado." }, { status: 403 });
    }

    const usageEventType = getUsageEventForServiceType(serviceType);

    if (usageEventType) {
      await assertPlanLimit(user.id, usageEventType);
    }

    const config = getSupabaseConfig();
    const service = HUMAN_REVIEW_SERVICES[serviceType];
    const orders = await supabaseRequest<CreatedOrder[]>(
      "/rest/v1/one_time_orders?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          case_id: caseId,
          service_type: serviceType,
          price_cents: service.priceCents,
          payment_status: "pending"
        })
      },
      token,
      config
    );
    const order = orders[0];

    if (!order) {
      throw new Error("Não foi possível criar a ordem de revisão humana.");
    }

    const stripeSession = await createStripeCheckoutSession(request, order.id, user.id, caseId, serviceType);

    if (usageEventType) {
      await recordUsageEvent(user.id, usageEventType);
    }

    await supabaseRequest(
      `/rest/v1/one_time_orders?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ stripe_checkout_session_id: stripeSession.id })
      },
      token,
      config
    );

    return NextResponse.json({
      checkoutUrl: stripeSession.url,
      orderId: order.id,
      serviceType,
      priceCents: service.priceCents
    });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Não foi possível criar o checkout de revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

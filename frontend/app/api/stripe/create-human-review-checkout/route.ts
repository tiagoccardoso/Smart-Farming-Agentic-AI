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
  stripe_checkout_session_id?: string | null;
  payment_status?: string | null;
};

type StripeSessionLookup = {
  id?: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string | null;
  error?: { message?: string };
};

async function retrieveOpenCheckoutUrl(sessionId: string | null | undefined) {
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) {
    return null;
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    cache: "no-store"
  });
  const session = (await response.json().catch(() => null)) as StripeSessionLookup | null;

  if (!response.ok) {
    return null;
  }

  return session?.status === "open" && session.url ? session.url : null;
}

function getUsageEventForServiceType(serviceType: string): UsageEventType | null {
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

    if (caseData.status === "deleted" || caseData.deleted_at) {
      return NextResponse.json({ error: "Não é possível pagar revisão de um caso excluído." }, { status: 400 });
    }

    if (serviceType === "human_case_review" && caseData.human_review_status !== "pending_payment") {
      return NextResponse.json({ error: "Solicite a revisão humana antes de iniciar o pagamento." }, { status: 400 });
    }

    const usageEventType = getUsageEventForServiceType(serviceType);

    if (usageEventType) {
      await assertPlanLimit(user.id, usageEventType);
    }

    const config = getSupabaseConfig();
    const service = HUMAN_REVIEW_SERVICES[serviceType];
    const existingOrders = await supabaseRequest<CreatedOrder[]>(
      `/rest/v1/one_time_orders?user_id=eq.${encodeURIComponent(user.id)}&case_id=eq.${encodeURIComponent(caseId)}&service_type=eq.${encodeURIComponent(serviceType)}&payment_status=eq.pending&select=id,stripe_checkout_session_id,payment_status&order=created_at.desc&limit=1`,
      { method: "GET" },
      token,
      config
    ).catch(() => []);

    let order = existingOrders[0];
    const reusableCheckoutUrl = await retrieveOpenCheckoutUrl(order?.stripe_checkout_session_id);

    if (order && reusableCheckoutUrl) {
      return NextResponse.json({
        checkoutUrl: reusableCheckoutUrl,
        orderId: order.id,
        serviceType,
        priceCents: service.priceCents,
        reusedCheckout: true
      });
    }

    if (!order) {
      const orders = await supabaseRequest<CreatedOrder[]>(
        "/rest/v1/one_time_orders?select=id,stripe_checkout_session_id,payment_status",
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
      order = orders[0];
    }

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

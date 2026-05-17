import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, extractBearerToken, getCurrentUser } from "../../../../lib/auth";
import {
  createStripeCustomer,
  createSubscriptionCheckoutSession,
  fetchPaidPlan,
  findReusableStripeCustomerId,
  isPaidPlanSlug,
  upsertSubscriptionRecord
} from "../../../../lib/stripe/subscription";

type CreateSubscriptionCheckoutPayload = {
  planSlug?: string;
};

function getRequestToken(request: NextRequest) {
  return extractBearerToken(request.headers.get("authorization")) || request.cookies.get(AUTH_ACCESS_COOKIE)?.value || null;
}

export async function POST(request: NextRequest) {
  try {
    const token = getRequestToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para assinar um plano pago." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as CreateSubscriptionCheckoutPayload | null;
    const planSlug = payload?.planSlug?.trim();

    if (!isPaidPlanSlug(planSlug)) {
      return NextResponse.json({ error: "Informe um planSlug pago válido para assinatura." }, { status: 400 });
    }

    const [user, plan] = await Promise.all([getCurrentUser(token), fetchPaidPlan(planSlug)]);
    const stripeCustomerId = (await findReusableStripeCustomerId(user.id)) || (await createStripeCustomer(user.id, user.email));
    const stripeSession = await createSubscriptionCheckoutSession(request, plan, user.id, stripeCustomerId);

    await upsertSubscriptionRecord({
      userId: user.id,
      planId: plan.id,
      stripeCustomerId,
      status: "checkout_pending"
    });

    return NextResponse.json({
      checkoutUrl: stripeSession.url,
      checkoutSessionId: stripeSession.id,
      planSlug: plan.slug,
      planId: plan.id,
      stripeCustomerId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível criar o checkout de assinatura.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

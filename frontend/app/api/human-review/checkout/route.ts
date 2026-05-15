import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";

type OneTimeOrder = {
  id: string;
};

type StripeCheckoutSession = {
  id?: string;
  url?: string;
  error?: {
    message?: string;
  };
};

const HUMAN_REVIEW_SERVICE_TYPE = "human_review_simple_case";
const DEFAULT_HUMAN_REVIEW_PRICE_CENTS = 19700;

function getHumanReviewPriceCents() {
  const configuredPrice = Number(process.env.HUMAN_REVIEW_PRICE_CENTS);
  return Number.isFinite(configuredPrice) && configuredPrice > 0 ? Math.round(configuredPrice) : DEFAULT_HUMAN_REVIEW_PRICE_CENTS;
}

function getRequestOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
}

async function createStripeCheckoutSession(request: NextRequest, orderId: string, caseId: string, priceCents: number) {
  // Configure STRIPE_SECRET_KEY no ambiente do servidor para habilitar o checkout real.
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  // Configure STRIPE_HUMAN_REVIEW_PRICE_ID com o priceId criado no Stripe para a revisão humana.
  const stripePriceId = process.env.STRIPE_HUMAN_REVIEW_PRICE_ID;

  if (!stripeSecretKey || !stripePriceId) {
    return null;
  }

  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/revisao-humana?caseId=${encodeURIComponent(caseId)}&checkout=success&orderId=${encodeURIComponent(orderId)}`,
    cancel_url: `${origin}/revisao-humana?caseId=${encodeURIComponent(caseId)}&checkout=cancelled&orderId=${encodeURIComponent(orderId)}`,
    client_reference_id: orderId,
    "line_items[0][price]": stripePriceId,
    "line_items[0][quantity]": "1",
    "metadata[order_id]": orderId,
    "metadata[case_id]": caseId,
    "metadata[service_type]": HUMAN_REVIEW_SERVICE_TYPE,
    "metadata[price_cents]": String(priceCents)
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params,
    cache: "no-store"
  });

  const session = (await response.json().catch(() => null)) as StripeCheckoutSession | null;

  if (!response.ok || !session?.id) {
    throw new Error(session?.error?.message || "Não foi possível iniciar o checkout do Stripe.");
  }

  return session;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para solicitar a revisão humana." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const payload = (await request.json()) as { caseId?: string };
    const caseId = payload.caseId?.trim();

    if (!caseId) {
      return NextResponse.json({ error: "Informe o caseId para solicitar revisão humana." }, { status: 400 });
    }

    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }

    const config = getSupabaseConfig();
    const priceCents = getHumanReviewPriceCents();
    const encodedCaseId = encodeURIComponent(caseId);
    const orders = await supabaseRequest<OneTimeOrder[]>(
      "/rest/v1/one_time_orders?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          case_id: caseId,
          service_type: HUMAN_REVIEW_SERVICE_TYPE,
          price_cents: priceCents,
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

    await supabaseRequest(
      `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          human_review_requested: true,
          human_review_status: "pending_payment"
        })
      },
      token,
      config
    );

    const stripeSession = await createStripeCheckoutSession(request, order.id, caseId, priceCents);

    if (stripeSession?.id) {
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
    }

    return NextResponse.json({
      orderId: order.id,
      checkoutUrl: stripeSession?.url ?? null,
      stripeConfigured: Boolean(stripeSession?.id),
      priceCents
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível solicitar a revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

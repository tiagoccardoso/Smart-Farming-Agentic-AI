/**
 * Checkout do Parecer Tecnico Avulso (Stripe Checkout Session, modo `payment`).
 *
 * Destinado a quem nao quer contratar a mensalidade da Consultoria Agronomica.
 * O preco vem de `plan_page_services`, configurado pela area administrativa —
 * nao existe valor fixado na interface. O parecer so e liberado quando o
 * webhook confirma o pagamento.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../../lib/billing/entitlements";
import {
  OneTimeOrder,
  TECHNICAL_OPINION_SERVICE_TYPE,
  createTechnicalOpinionCheckoutSession,
  fetchConfiguredOneTimeService,
  supabaseAdminRequest
} from "../../../../lib/stripe/humanReview";
import { errorMessage, errorStatus, requireUser } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

type StripeSessionLookup = {
  id?: string;
  url?: string | null;
  status?: string | null;
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

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);

    if (!access.profileActive) {
      return NextResponse.json({ error: "Usuario inativo. Entre em contato com o suporte." }, { status: 403 });
    }

    const service = await fetchConfiguredOneTimeService(TECHNICAL_OPINION_SERVICE_TYPE);

    if (!service) {
      return NextResponse.json(
        {
          error:
            "O Parecer Tecnico Avulso ainda nao esta disponivel. O preco precisa ser configurado na area administrativa da PlantaSa."
        },
        { status: 503 }
      );
    }

    // Reaproveita um checkout em aberto do mesmo usuario, evitando ordens orfas.
    const pendingOrders = await supabaseAdminRequest<OneTimeOrder[]>(
      `/rest/v1/one_time_orders?user_id=eq.${encodeURIComponent(user.id)}&service_type=eq.${encodeURIComponent(TECHNICAL_OPINION_SERVICE_TYPE)}&payment_status=eq.pending&select=id,stripe_checkout_session_id,payment_status&order=created_at.desc&limit=1`,
      { method: "GET" }
    ).catch(() => [] as OneTimeOrder[]);

    let order = pendingOrders[0];
    const reusableCheckoutUrl = await retrieveOpenCheckoutUrl(order?.stripe_checkout_session_id);

    if (order && reusableCheckoutUrl) {
      return NextResponse.json({
        checkoutUrl: reusableCheckoutUrl,
        orderId: order.id,
        serviceType: TECHNICAL_OPINION_SERVICE_TYPE,
        priceCents: service.priceCents,
        reusedCheckout: true
      });
    }

    if (!order) {
      const orders = await supabaseAdminRequest<OneTimeOrder[]>(
        "/rest/v1/one_time_orders?select=id,stripe_checkout_session_id,payment_status",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: user.id,
            case_id: null,
            service_type: TECHNICAL_OPINION_SERVICE_TYPE,
            price_cents: service.priceCents,
            payment_status: "pending"
          })
        }
      );
      order = orders[0];
    }

    if (!order) {
      throw new Error("Nao foi possivel registrar o pedido do parecer tecnico avulso.");
    }

    const stripeSession = await createTechnicalOpinionCheckoutSession(request, order.id, user.id, service);

    await supabaseAdminRequest(`/rest/v1/one_time_orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ stripe_checkout_session_id: stripeSession.id })
    });

    return NextResponse.json({
      checkoutUrl: stripeSession.url,
      orderId: order.id,
      serviceType: TECHNICAL_OPINION_SERVICE_TYPE,
      priceCents: service.priceCents
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel iniciar o pagamento do parecer tecnico avulso.") },
      { status: errorStatus(error) }
    );
  }
}

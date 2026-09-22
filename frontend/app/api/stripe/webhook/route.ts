/**
 * Webhook do Stripe — fonte confiavel do estado de pagamento e assinatura.
 *
 * O retorno do navegador após o Checkout nunca libera recursos: quem confirma
 * pagamento, ativa assinatura, registra falha e libera parecer avulso e este
 * endpoint. Toda entrega e idempotente (registro de `event.id`).
 *
 * Eventos tratados:
 *   checkout.session.completed          -> checkout concluído (assinatura ou avulso)
 *   customer.subscription.created       -> assinatura criada
 *   customer.subscription.updated       -> alteração (upgrade/downgrade/cancelamento agendado)
 *   customer.subscription.deleted       -> assinatura cancelada/encerrada
 *   invoice.payment_succeeded / invoice.paid -> pagamento recorrente confirmado
 *   invoice.payment_failed              -> pagamento recorrente com falha
 *   payment_intent.succeeded            -> pagamento avulso confirmado (reforco)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  OneTimeOrder,
  StripeCheckoutSession,
  TECHNICAL_OPINION_SERVICE_TYPE,
  getCaseUpdateForServiceType,
  isHumanReviewServiceType,
  supabaseAdminRequest
} from "../../../../lib/stripe/humanReview";
import {
  Plan,
  StripeSubscription,
  StripeSubscriptionCheckoutSession,
  getStripeCustomerId,
  getStripeSubscriptionId,
  getStripeSubscriptionPeriod,
  retrieveStripeSubscription,
  stripeTimestampToIso,
  upsertSubscriptionRecord
} from "../../../../lib/stripe/subscription";
import { verifyStripeSignature } from "../../../../lib/stripe/signature";
import {
  claimStripeEvent,
  markStripeEventFailed,
  markStripeEventProcessed
} from "../../../../lib/stripe/webhook-events";
import { mapStripeSubscriptionStatus } from "../../../../lib/billing/subscription-state";
import { grantTechnicalOpinionCredit } from "../../../../lib/billing/technical-opinions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeInvoice = {
  id?: string;
  subscription?: string | { id?: string } | null;
  customer?: string | { id?: string } | null;
  status?: string | null;
  amount_paid?: number | null;
  payment_intent?: string | { id?: string } | null;
};

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

type HandlerResult = Record<string, unknown> & { ignored?: boolean };

function getMetadataValue(metadata: Record<string, string | undefined> | null | undefined, camelKey: string, snakeKey: string) {
  return metadata?.[camelKey] || metadata?.[snakeKey] || null;
}

function toId(value: string | { id?: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

async function findPlanForSubscription(
  subscription: StripeSubscription,
  fallbackMetadata?: Record<string, string | undefined> | null
) {
  const planId =
    getMetadataValue(subscription.metadata, "planId", "plan_id") || getMetadataValue(fallbackMetadata, "planId", "plan_id");
  const planSlug =
    getMetadataValue(subscription.metadata, "planSlug", "plan_slug") ||
    getMetadataValue(fallbackMetadata, "planSlug", "plan_slug");
  const priceId = subscription.items?.data?.find((item) => item.price?.id)?.price?.id;

  // O Price ID vence: após um upgrade/downgrade o metadata pode estar defasado.
  const orderedFilters = [
    priceId ? `stripe_price_id=eq.${encodeURIComponent(priceId)}` : null,
    planId ? `id=eq.${encodeURIComponent(planId)}` : null,
    planSlug ? `slug=eq.${encodeURIComponent(planSlug)}` : null
  ].filter((filter): filter is string => Boolean(filter));

  for (const filter of orderedFilters) {
    const plans = await supabaseAdminRequest<Plan[]>(
      `/rest/v1/plans?${filter}&select=id,slug,name,price_cents,billing_type,stripe_product_id,stripe_price_id,active&limit=1`,
      { method: "GET" }
    );

    if (plans[0]) {
      return plans[0];
    }
  }

  return null;
}

async function resolveUserIdForSubscription(
  subscription: StripeSubscription,
  fallbackMetadata?: Record<string, string | undefined> | null
) {
  const fromMetadata =
    getMetadataValue(subscription.metadata, "userId", "user_id") || getMetadataValue(fallbackMetadata, "userId", "user_id");

  if (fromMetadata) {
    return fromMetadata;
  }

  // Assinaturas alteradas pelo Customer Portal podem chegar sem metadata.
  const stripeSubscriptionId = subscription.id;
  const stripeCustomerId = getStripeCustomerId(subscription);
  const filter = stripeSubscriptionId
    ? `stripe_subscription_id=eq.${encodeURIComponent(stripeSubscriptionId)}`
    : stripeCustomerId
      ? `stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}`
      : null;

  if (!filter) {
    return null;
  }

  const rows = await supabaseAdminRequest<Array<{ user_id: string | null }>>(
    `/rest/v1/subscriptions?${filter}&select=user_id&order=created_at.desc&limit=1`,
    { method: "GET" }
  );

  return rows[0]?.user_id ?? null;
}

async function handleSubscriptionChange(
  subscription: StripeSubscription,
  fallbackMetadata?: Record<string, string | undefined> | null
): Promise<HandlerResult> {
  const [userId, plan] = await Promise.all([
    resolveUserIdForSubscription(subscription, fallbackMetadata),
    findPlanForSubscription(subscription, fallbackMetadata)
  ]);
  const stripeCustomerId = getStripeCustomerId(subscription);
  const stripeSubscriptionId = subscription.id;

  if (!userId || !stripeCustomerId || !stripeSubscriptionId || !plan) {
    return { updated: false, ignored: true, reason: "missing_subscription_metadata" };
  }

  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const internalStatus = mapStripeSubscriptionStatus(subscription.status, cancelAtPeriodEnd);
  const period = getStripeSubscriptionPeriod(subscription);

  const subscriptionId = await upsertSubscriptionRecord({
    userId,
    planId: plan.id,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId: subscription.items?.data?.find((item) => item.price?.id)?.price?.id ?? null,
    status: subscription.status || "unknown",
    internalStatus,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd,
    canceledAt: stripeTimestampToIso(subscription.canceled_at)
  });

  return {
    updated: true,
    subscriptionId,
    userId,
    planId: plan.id,
    planSlug: plan.slug,
    internalStatus,
    stripeSubscriptionId
  };
}

async function handleSubscriptionCheckoutCompleted(session: StripeSubscriptionCheckoutSession): Promise<HandlerResult> {
  const stripeSubscriptionId = getStripeSubscriptionId(session);

  if (!stripeSubscriptionId) {
    return { updated: false, ignored: true, reason: "missing_stripe_subscription_id" };
  }

  const subscription = await retrieveStripeSubscription(stripeSubscriptionId);

  return handleSubscriptionChange(subscription, session.metadata);
}

async function handleInvoiceEvent(invoice: StripeInvoice, paid: boolean): Promise<HandlerResult> {
  const stripeSubscriptionId = toId(invoice.subscription);

  if (!stripeSubscriptionId) {
    return { updated: false, ignored: true, reason: "invoice_without_subscription" };
  }

  // Reconsulta a assinatura para gravar o estado real (e não o da fatura).
  const subscription = await retrieveStripeSubscription(stripeSubscriptionId);
  const result = await handleSubscriptionChange(subscription);

  await supabaseAdminRequest(
    `/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(stripeSubscriptionId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        last_payment_status: paid ? "paid" : "failed",
        last_payment_at: new Date().toISOString()
      })
    }
  ).catch(() => undefined);

  return { ...result, invoiceId: invoice.id ?? null, paymentStatus: paid ? "paid" : "failed" };
}

// ---------------------------------------------------------------------------
// Pagamentos avulsos
// ---------------------------------------------------------------------------

async function updateCaseAfterPayment(caseId: string | null | undefined, serviceType: string | null | undefined) {
  if (!caseId || !isHumanReviewServiceType(serviceType)) {
    return;
  }

  const caseUpdate = getCaseUpdateForServiceType(serviceType);

  if (!caseUpdate) {
    return;
  }

  await supabaseAdminRequest(`/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(caseUpdate)
  });
}

async function markOneTimeOrderAsPaid(session: StripeCheckoutSession): Promise<HandlerResult> {
  const orderId = getMetadataValue(session.metadata, "orderId", "order_id");
  const metadataUserId = getMetadataValue(session.metadata, "userId", "user_id");
  const metadataCaseId = getMetadataValue(session.metadata, "caseId", "case_id");
  const metadataServiceType = getMetadataValue(session.metadata, "serviceType", "service_type");

  if (!orderId) {
    return { updated: false, ignored: true, reason: "missing_order_id" };
  }

  const orders = await supabaseAdminRequest<OneTimeOrder[]>(
    `/rest/v1/one_time_orders?id=eq.${encodeURIComponent(orderId)}&select=id,case_id,user_id,service_type,price_cents,payment_status&limit=1`,
    { method: "GET" }
  );
  const order = orders[0];

  if (!order) {
    return { updated: false, ignored: true, reason: "order_not_found" };
  }

  const caseId = metadataCaseId || order.case_id;
  const serviceType = metadataServiceType || order.service_type;
  const userId = order.user_id || metadataUserId;

  if (metadataUserId && order.user_id && metadataUserId !== order.user_id) {
    return { updated: false, ignored: true, orderId, reason: "metadata_user_mismatch" };
  }

  if (metadataCaseId && order.case_id && metadataCaseId !== order.case_id) {
    return { updated: false, ignored: true, orderId, reason: "metadata_case_mismatch" };
  }

  if (metadataServiceType && order.service_type && metadataServiceType !== order.service_type) {
    return { updated: false, ignored: true, orderId, reason: "metadata_service_mismatch" };
  }

  const alreadyPaid = order.payment_status === "paid";

  if (!alreadyPaid) {
    await supabaseAdminRequest(
      `/rest/v1/one_time_orders?id=eq.${encodeURIComponent(orderId)}&payment_status=neq.paid`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ payment_status: "paid", stripe_checkout_session_id: session.id ?? null })
      }
    );
  }

  // Parecer técnico avulso: libera exatamente 1 demanda técnica.
  // A unicidade de stripe_checkout_session_id / one_time_order_id garante que
  // uma reentrega do mesmo evento nunca libere um segundo parecer.
  if (serviceType === TECHNICAL_OPINION_SERVICE_TYPE) {
    if (!userId) {
      return { updated: false, ignored: true, orderId, reason: "missing_user_for_credit" };
    }

    const credit = await grantTechnicalOpinionCredit({
      userId,
      oneTimeOrderId: orderId,
      stripeCheckoutSessionId: session.id ?? null,
      stripePaymentIntentId: toId(session.payment_intent),
      amountCents: session.amount_total ?? order.price_cents ?? null
    });

    return {
      updated: !alreadyPaid,
      orderId,
      serviceType,
      creditGranted: credit.granted,
      creditId: credit.creditId,
      creditReason: credit.reason
    };
  }

  await updateCaseAfterPayment(caseId, serviceType);

  return { updated: !alreadyPaid, orderId, caseId, serviceType, reason: alreadyPaid ? "already_paid" : undefined };
}

// ---------------------------------------------------------------------------
// Roteamento dos eventos
// ---------------------------------------------------------------------------

async function processEvent(event: StripeEvent, stripeObject: Record<string, unknown>): Promise<HandlerResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = stripeObject as StripeCheckoutSession & StripeSubscriptionCheckoutSession;

      if (session.mode === "subscription") {
        return handleSubscriptionCheckoutCompleted(session);
      }

      if (session.payment_status && session.payment_status !== "paid") {
        return { updated: false, ignored: true, reason: "payment_not_paid" };
      }

      return markOneTimeOrderAsPaid(session);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Eventos podem chegar fora de ordem: grava o estado ATUAL da assinatura
      // no Stripe (plano, status, período, cancel_at_period_end), e não o
      // retrato possivelmente antigo contido no evento.
      const payload = stripeObject as StripeSubscription;
      const current = payload.id ? await retrieveStripeSubscription(payload.id).catch(() => null) : null;
      return handleSubscriptionChange(current?.id ? current : payload, payload.metadata);
    }

    case "invoice.paid":
    case "invoice.payment_succeeded":
      return handleInvoiceEvent(stripeObject as StripeInvoice, true);

    case "invoice.payment_failed":
      return handleInvoiceEvent(stripeObject as StripeInvoice, false);

    default:
      return { ignored: true, reason: "event_not_handled" };
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!webhookSecret) {
    return NextResponse.json({ error: "Configure STRIPE_WEBHOOK_SECRET para validar webhooks do Stripe." }, { status: 500 });
  }

  if (!signature || !verifyStripeSignature(payload, signature, webhookSecret)) {
    return NextResponse.json({ error: "Assinatura do Stripe inválida." }, { status: 400 });
  }

  let event: StripeEvent;

  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Payload do Stripe inválido." }, { status: 400 });
  }

  const eventId = event.id;
  const stripeObject = event.data?.object;

  if (!eventId || !stripeObject) {
    return NextResponse.json({ error: "Evento do Stripe incompleto." }, { status: 400 });
  }

  try {
    const claim = await claimStripeEvent(eventId, event.type ?? "unknown");

    if (!claim.claimed) {
      if (claim.reason === "in_progress") {
        return NextResponse.json({ received: false, inProgress: true, eventId }, { status: 409 });
      }
      return NextResponse.json({ received: true, duplicate: true, eventId });
    }

    const result = await processEvent(event, stripeObject);
    await markStripeEventProcessed(eventId, result, Boolean(result.ignored));

    return NextResponse.json({ received: true, eventId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível processar o webhook do Stripe.";
    await markStripeEventFailed(eventId, message);

    // 500 faz o Stripe reenviar o evento; o registro em `failed` permite o reprocessamento.
    return NextResponse.json({ error: message, eventId }, { status: 500 });
  }
}

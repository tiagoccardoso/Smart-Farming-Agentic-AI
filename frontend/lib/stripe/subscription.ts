/**
 * Integração com o Stripe para assinaturas mensais.
 *
 * Nenhum `price_id` fica escrito no código: os identificadores vem de
 * `plans.stripe_product_id` / `plans.stripe_price_id`, configurados na área
 * administrativa. Enquanto o Price ID não for informado, o Checkout usa
 * `price_data` inline (comportamento que já existia no projeto).
 */

import { NextRequest } from "next/server";
import {
  PlanRecord,
  fetchSubscribablePlan,
  isSubscribablePlanCode
} from "../billing/entitlements";
import { InternalSubscriptionState, mapStripeSubscriptionStatus } from "../billing/subscription-state";
import { supabaseAdminRequest } from "../server/supabaseAdmin";
import { getRequestOrigin } from "./humanReview";

export type Plan = PlanRecord;

export type SubscriptionRow = {
  id: string;
  user_id?: string | null;
  plan_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
  internal_status?: string | null;
  current_period_end?: string | null;
};

export type StripeCustomer = {
  id?: string;
  error?: { message?: string };
};

export type StripeSubscriptionItem = {
  id?: string;
  /** API Stripe 2025-03-31+: o período passou da assinatura para o item. */
  current_period_start?: number | null;
  current_period_end?: number | null;
  price?: {
    id?: string | null;
    product?: string | null;
    metadata?: Record<string, string | undefined> | null;
  } | null;
};

export type StripeSubscription = {
  id?: string;
  customer?: string | { id?: string } | null;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  metadata?: Record<string, string | undefined> | null;
  items?: { data?: StripeSubscriptionItem[] } | null;
};

export type StripeSubscriptionCheckoutSession = {
  id?: string;
  url?: string;
  mode?: string;
  customer?: string | { id?: string } | null;
  subscription?: string | StripeSubscription | null;
  metadata?: Record<string, string | undefined> | null;
  error?: { message?: string };
};

export type StripeBillingPortalSession = {
  id?: string;
  url?: string;
  error?: { message?: string };
};

/** Mantido por compatibilidade: a lista real vem de `plans` (billing_type = monthly e active). */
export const isPaidPlanSlug = isSubscribablePlanCode;
export const fetchPaidPlan = fetchSubscribablePlan;

export function getStripeSecretKey() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error("Configure STRIPE_SECRET_KEY para criar assinaturas no Stripe.");
  }

  return stripeSecretKey;
}

function getStripeId(value: string | { id?: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export function getStripeCustomerId(value: StripeSubscription | StripeSubscriptionCheckoutSession | null | undefined) {
  return getStripeId(value?.customer);
}

export function getStripeSubscriptionId(value: StripeSubscriptionCheckoutSession | null | undefined) {
  return getStripeId(value?.subscription);
}

export function stripeTimestampToIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

/**
 * Período vigente da assinatura, compatível com as duas versões da API do
 * Stripe (campo na assinatura ou, nas versões novas, no item). É o período que
 * define o ciclo mensal dos pareceres; sem ele o sistema cai no mês calendário.
 */
export function getStripeSubscriptionPeriod(subscription: StripeSubscription) {
  const item = subscription.items?.data?.find((entry) => entry.current_period_start || entry.current_period_end);

  return {
    start: stripeTimestampToIso(subscription.current_period_start ?? item?.current_period_start),
    end: stripeTimestampToIso(subscription.current_period_end ?? item?.current_period_end)
  };
}

export async function stripeRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...init.headers
    },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.error?.message || "Não foi possível comunicar com o Stripe.");
  }

  return payload as T;
}

export async function findReusableStripeCustomerId(userId: string) {
  const subscriptions = await supabaseAdminRequest<SubscriptionRow[]>(
    `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&stripe_customer_id=not.is.null&select=id,stripe_customer_id&order=created_at.desc&limit=1`,
    { method: "GET" }
  );

  return subscriptions[0]?.stripe_customer_id ?? null;
}

export async function createStripeCustomer(userId: string, email?: string | null) {
  const params = new URLSearchParams({ "metadata[userId]": userId });

  if (email) {
    params.set("email", email);
  }

  const customer = await stripeRequest<StripeCustomer>("/customers", { method: "POST", body: params });

  if (!customer.id) {
    throw new Error("O Stripe não retornou um customer válido.");
  }

  return customer.id;
}

export async function resolveStripeCustomerId(userId: string, email?: string | null) {
  return (await findReusableStripeCustomerId(userId)) || (await createStripeCustomer(userId, email));
}

function applyLineItem(params: URLSearchParams, plan: Plan) {
  params.set("line_items[0][quantity]", "1");

  if (plan.stripe_price_id) {
    params.set("line_items[0][price]", plan.stripe_price_id);
    return;
  }

  params.set("line_items[0][price_data][currency]", "brl");
  params.set("line_items[0][price_data][unit_amount]", String(plan.price_cents));
  params.set("line_items[0][price_data][recurring][interval]", "month");

  if (plan.stripe_product_id) {
    params.set("line_items[0][price_data][product]", plan.stripe_product_id);
    return;
  }

  params.set("line_items[0][price_data][product_data][name]", plan.name || plan.slug || "Assinatura mensal");
  params.set("line_items[0][price_data][product_data][metadata][planSlug]", plan.slug ?? "");
  params.set("line_items[0][price_data][product_data][metadata][planId]", plan.id);
}

export async function createSubscriptionCheckoutSession(
  request: NextRequest,
  plan: Plan,
  userId: string,
  stripeCustomerId: string
) {
  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    mode: "subscription",
    customer: stripeCustomerId,
    success_url: `${origin}/checkout/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancelado`,
    client_reference_id: userId,
    "metadata[userId]": userId,
    "metadata[planSlug]": plan.slug ?? "",
    "metadata[planId]": plan.id,
    "subscription_data[metadata][userId]": userId,
    "subscription_data[metadata][planSlug]": plan.slug ?? "",
    "subscription_data[metadata][planId]": plan.id
  });

  applyLineItem(params, plan);

  const session = await stripeRequest<StripeSubscriptionCheckoutSession>("/checkout/sessions", {
    method: "POST",
    body: params
  });

  if (!session.id || !session.url) {
    throw new Error(session.error?.message || "Não foi possível iniciar o checkout de assinatura no Stripe.");
  }

  return session;
}

/**
 * Portal de cobrança do Stripe: o assinante gerencia cartão, faturas e
 * cancelamento sem que a PlantaSa manipule dados de pagamento.
 */
export async function createBillingPortalSession(request: NextRequest, stripeCustomerId: string) {
  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    customer: stripeCustomerId,
    return_url: `${origin}/minha-assinatura`
  });

  const session = await stripeRequest<StripeBillingPortalSession>("/billing_portal/sessions", {
    method: "POST",
    body: params
  });

  if (!session.url) {
    throw new Error(session.error?.message || "Não foi possível abrir o portal de cobrança do Stripe.");
  }

  return session;
}

export async function retrieveStripeSubscription(stripeSubscriptionId: string) {
  return stripeRequest<StripeSubscription>(`/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    method: "GET"
  });
}

export type ProrationBehavior = "create_prorations" | "none" | "always_invoice";

/**
 * Upgrade/downgrade entre planos pagos.
 *
 * Regra de proration adotada (explicita, conforme decisao do projeto):
 * `create_prorations` — o Stripe credita o valor não utilizado do plano atual e
 * cobra a diferenca proporcional do novo plano na próxima fatura. O usuário e
 * avisado disso antes de confirmar a troca.
 */
export async function updateSubscriptionPlan(input: {
  stripeSubscriptionId: string;
  plan: Plan;
  userId: string;
  prorationBehavior?: ProrationBehavior;
}) {
  if (!input.plan.stripe_price_id) {
    throw new Error(
      "Para trocar de plano com cobrança proporcional é necessário configurar o Stripe Price ID do plano de destino na área administrativa."
    );
  }

  const subscription = await retrieveStripeSubscription(input.stripeSubscriptionId);
  const itemId = subscription.items?.data?.[0]?.id;

  if (!itemId) {
    throw new Error("A assinatura atual no Stripe não possui um item para atualizar.");
  }

  const params = new URLSearchParams({
    "items[0][id]": itemId,
    "items[0][price]": input.plan.stripe_price_id,
    proration_behavior: input.prorationBehavior ?? "create_prorations",
    cancel_at_period_end: "false",
    "metadata[userId]": input.userId,
    "metadata[planSlug]": input.plan.slug ?? "",
    "metadata[planId]": input.plan.id,
    payment_behavior: "allow_incomplete"
  });

  return stripeRequest<StripeSubscription>(`/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`, {
    method: "POST",
    body: params
  });
}

export type UpsertSubscriptionInput = {
  userId: string;
  planId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  status: string;
  internalStatus?: InternalSubscriptionState | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  canceledAt?: string | null;
  lastPaymentStatus?: string | null;
  lastPaymentAt?: string | null;
};

/**
 * Grava o estado da assinatura. Sempre chamado a partir do webhook, que e a
 * fonte confiavel; o retorno do navegador após o Checkout nunca libera recurso.
 */
export async function upsertSubscriptionRecord(input: UpsertSubscriptionInput) {
  const internalStatus =
    input.internalStatus ?? mapStripeSubscriptionStatus(input.status, Boolean(input.cancelAtPeriodEnd));

  const record: Record<string, unknown> = {
    user_id: input.userId,
    plan_id: input.planId,
    stripe_customer_id: input.stripeCustomerId,
    stripe_subscription_id: input.stripeSubscriptionId ?? null,
    stripe_price_id: input.stripePriceId ?? null,
    status: input.status,
    internal_status: internalStatus,
    current_period_start: input.currentPeriodStart ?? null,
    current_period_end: input.currentPeriodEnd ?? null,
    cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
    canceled_at: input.canceledAt ?? null
  };

  if (input.lastPaymentStatus) {
    record.last_payment_status = input.lastPaymentStatus;
    record.last_payment_at = input.lastPaymentAt ?? new Date().toISOString();
  }

  const existing = input.stripeSubscriptionId
    ? await supabaseAdminRequest<SubscriptionRow[]>(
        `/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(input.stripeSubscriptionId)}&select=id&limit=1`,
        { method: "GET" }
      )
    : await supabaseAdminRequest<SubscriptionRow[]>(
        `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(input.userId)}&stripe_customer_id=eq.${encodeURIComponent(input.stripeCustomerId)}&stripe_subscription_id=is.null&select=id&order=created_at.desc&limit=1`,
        { method: "GET" }
      );

  const reusablePending =
    !existing[0]?.id && input.stripeSubscriptionId
      ? await supabaseAdminRequest<SubscriptionRow[]>(
          `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(input.userId)}&stripe_customer_id=eq.${encodeURIComponent(input.stripeCustomerId)}&stripe_subscription_id=is.null&select=id&order=created_at.desc&limit=1`,
          { method: "GET" }
        )
      : [];
  const existingId = existing[0]?.id || reusablePending[0]?.id;

  if (existingId) {
    await supabaseAdminRequest(`/rest/v1/subscriptions?id=eq.${encodeURIComponent(existingId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(record)
    });

    return existingId;
  }

  const rows = await supabaseAdminRequest<SubscriptionRow[]>("/rest/v1/subscriptions?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(record)
  });

  return rows[0]?.id ?? null;
}

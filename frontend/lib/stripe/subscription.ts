import { NextRequest } from "next/server";
import { getRequestOrigin, supabaseAdminRequest } from "./humanReview";

export type PaidPlanSlug = "ia-basica" | "ia-profissional" | "ia-revisao-humana";

export type Plan = {
  id: string;
  name: string | null;
  slug: string | null;
  price_cents: number | null;
  billing_type: string | null;
  stripe_price_id: string | null;
  active: boolean | null;
};

export type SubscriptionRow = {
  id: string;
  user_id?: string | null;
  plan_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

export type StripeCustomer = {
  id?: string;
  error?: {
    message?: string;
  };
};

export type StripeSubscription = {
  id?: string;
  customer?: string | { id?: string } | null;
  status?: string | null;
  current_period_end?: number | null;
  metadata?: Record<string, string | undefined> | null;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
        metadata?: Record<string, string | undefined> | null;
      } | null;
    }>;
  } | null;
};

export type StripeSubscriptionCheckoutSession = {
  id?: string;
  url?: string;
  mode?: string;
  customer?: string | { id?: string } | null;
  subscription?: string | StripeSubscription | null;
  metadata?: Record<string, string | undefined> | null;
  error?: {
    message?: string;
  };
};

export const PAID_PLAN_SLUGS = ["ia-basica", "ia-profissional", "ia-revisao-humana"] as const;

export function isPaidPlanSlug(value: unknown): value is PaidPlanSlug {
  return typeof value === "string" && PAID_PLAN_SLUGS.includes(value as PaidPlanSlug);
}

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

export async function fetchPaidPlan(planSlug: PaidPlanSlug) {
  const plans = await supabaseAdminRequest<Plan[]>(
    `/rest/v1/plans?slug=eq.${encodeURIComponent(planSlug)}&active=eq.true&select=id,name,slug,price_cents,billing_type,stripe_price_id,active&limit=1`,
    { method: "GET" }
  );
  const plan = plans[0];

  if (!plan || plan.billing_type !== "monthly" || !plan.price_cents || plan.price_cents <= 0) {
    throw new Error("Plano pago mensal não encontrado ou inativo.");
  }

  return plan;
}

export async function findReusableStripeCustomerId(userId: string) {
  const subscriptions = await supabaseAdminRequest<SubscriptionRow[]>(
    `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&stripe_customer_id=not.is.null&select=id,stripe_customer_id&order=created_at.desc&limit=1`,
    { method: "GET" }
  );

  return subscriptions[0]?.stripe_customer_id ?? null;
}

export async function createStripeCustomer(userId: string, email?: string | null) {
  const params = new URLSearchParams({
    "metadata[userId]": userId
  });

  if (email) {
    params.set("email", email);
  }

  const customer = await stripeRequest<StripeCustomer>("/customers", {
    method: "POST",
    body: params
  });

  if (!customer.id) {
    throw new Error("O Stripe não retornou um customer válido.");
  }

  return customer.id;
}

export async function createSubscriptionCheckoutSession(request: NextRequest, plan: Plan, userId: string, stripeCustomerId: string) {
  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    mode: "subscription",
    customer: stripeCustomerId,
    success_url: `${origin}/planos?subscription=success`,
    cancel_url: `${origin}/planos?subscription=cancelled`,
    client_reference_id: userId,
    "line_items[0][quantity]": "1",
    "metadata[userId]": userId,
    "metadata[planSlug]": plan.slug ?? "",
    "metadata[planId]": plan.id,
    "subscription_data[metadata][userId]": userId,
    "subscription_data[metadata][planSlug]": plan.slug ?? "",
    "subscription_data[metadata][planId]": plan.id
  });

  if (plan.stripe_price_id) {
    params.set("line_items[0][price]", plan.stripe_price_id);
  } else {
    params.set("line_items[0][price_data][currency]", "brl");
    params.set("line_items[0][price_data][unit_amount]", String(plan.price_cents));
    params.set("line_items[0][price_data][recurring][interval]", "month");
    params.set("line_items[0][price_data][product_data][name]", plan.name || plan.slug || "Assinatura mensal");
    params.set("line_items[0][price_data][product_data][metadata][planSlug]", plan.slug ?? "");
    params.set("line_items[0][price_data][product_data][metadata][planId]", plan.id);
  }

  const session = await stripeRequest<StripeSubscriptionCheckoutSession>("/checkout/sessions", {
    method: "POST",
    body: params
  });

  if (!session.id || !session.url) {
    throw new Error(session.error?.message || "Não foi possível iniciar o checkout de assinatura no Stripe.");
  }

  return session;
}

export async function upsertSubscriptionRecord(input: {
  userId: string;
  planId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  status: string;
  currentPeriodEnd?: string | null;
}) {
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
      body: JSON.stringify({
        user_id: input.userId,
        plan_id: input.planId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId ?? null,
        status: input.status,
        current_period_end: input.currentPeriodEnd ?? null
      })
    });

    return existingId;
  }

  const rows = await supabaseAdminRequest<SubscriptionRow[]>("/rest/v1/subscriptions?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: input.userId,
      plan_id: input.planId,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      status: input.status,
      current_period_end: input.currentPeriodEnd ?? null
    })
  });

  return rows[0]?.id ?? null;
}

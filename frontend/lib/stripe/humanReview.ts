/**
 * Serviços avulsos (pagamento único) no Stripe.
 *
 * Inclui os serviços que já existiam (revisao humana de caso, análise de solo,
 * relatório técnico, acompanhamento mensal) e o novo "Parecer Técnico Avulso",
 * destinado a quem não quer contratar a mensalidade da Consultoria Agronômica.
 *
 * Preços e identificadores Stripe vem de `plan_page_services`, configurados na
 * área administrativa. Nada e fixado na interface nem no código.
 */

import { NextRequest } from "next/server";

export { getSupabaseAdminConfig, supabaseAdminRequest } from "../server/supabaseAdmin";
import { supabaseAdminRequest } from "../server/supabaseAdmin";

/** Serviços avulsos vinculados a um caso agronômico existente. */
export type HumanReviewServiceType = "human_case_review" | "soil_analysis_review" | "technical_report" | "monthly_farm_followup";

/** Serviço avulso que libera 1 demanda técnica, sem exigir caso previo. */
export const TECHNICAL_OPINION_SERVICE_TYPE = "technical_opinion_single";

export type OneTimeServiceType = HumanReviewServiceType | typeof TECHNICAL_OPINION_SERVICE_TYPE;

export const HUMAN_REVIEW_SERVICE_TYPES: HumanReviewServiceType[] = [
  "human_case_review",
  "soil_analysis_review",
  "technical_report",
  "monthly_farm_followup"
];

export const ONE_TIME_SERVICE_TYPES: OneTimeServiceType[] = [
  ...HUMAN_REVIEW_SERVICE_TYPES,
  TECHNICAL_OPINION_SERVICE_TYPE
];

export type StripeCheckoutSession = {
  id?: string;
  url?: string;
  payment_status?: string;
  payment_intent?: string | { id?: string } | null;
  amount_total?: number | null;
  metadata?: Record<string, string | undefined> | null;
  error?: { message?: string };
};

export type OneTimeOrder = {
  id: string;
  case_id?: string | null;
  user_id?: string | null;
  service_type?: string | null;
  price_cents?: number | null;
  payment_status?: string | null;
  stripe_checkout_session_id?: string | null;
};

export type HumanReviewCaseUpdate = {
  human_review_requested: boolean;
  human_review_status: "waiting_review" | "waiting_soil_review" | "waiting_technical_report";
  status: "waiting_human_review";
};

const HUMAN_REVIEW_CASE_STATUS_BY_SERVICE: Partial<Record<HumanReviewServiceType, HumanReviewCaseUpdate["human_review_status"]>> = {
  human_case_review: "waiting_review",
  soil_analysis_review: "waiting_soil_review",
  technical_report: "waiting_technical_report"
};

export function isHumanReviewServiceType(value: unknown): value is HumanReviewServiceType {
  return typeof value === "string" && HUMAN_REVIEW_SERVICE_TYPES.includes(value as HumanReviewServiceType);
}

export function isOneTimeServiceType(value: unknown): value is OneTimeServiceType {
  return typeof value === "string" && ONE_TIME_SERVICE_TYPES.includes(value as OneTimeServiceType);
}

export type ConfiguredOneTimeService = {
  serviceType: OneTimeServiceType;
  label: string;
  priceCents: number;
  stripeProductId: string | null;
  stripePriceId: string | null;
};

export type ConfiguredHumanReviewService = ConfiguredOneTimeService;

/**
 * Um serviço só pode ser cobrado quando está ativo E tem preço configurado.
 * Preço zero significa "ainda não configurado": o serviço não e vendido.
 */
export async function fetchConfiguredOneTimeService(serviceType: OneTimeServiceType) {
  const rows = await supabaseAdminRequest<
    Array<{ name: string | null; price_cents: number | null; stripe_product_id: string | null; stripe_price_id: string | null }>
  >(
    `/rest/v1/plan_page_services?service_type=eq.${encodeURIComponent(serviceType)}&active=eq.true&select=name,price_cents,stripe_product_id,stripe_price_id&limit=1`,
    { method: "GET" }
  );
  const service = rows[0];
  const priceCents = service?.price_cents;

  if (!service?.name || typeof priceCents !== "number" || !Number.isSafeInteger(priceCents) || priceCents <= 0) {
    return null;
  }

  return {
    serviceType,
    label: service.name,
    priceCents,
    stripeProductId: service.stripe_product_id ?? null,
    stripePriceId: service.stripe_price_id ?? null
  } satisfies ConfiguredOneTimeService;
}

/** Mantido para compatibilidade com as rotas já existentes. */
export async function fetchConfiguredHumanReviewService(serviceType: HumanReviewServiceType) {
  return fetchConfiguredOneTimeService(serviceType);
}

export function getCaseUpdateForServiceType(serviceType: HumanReviewServiceType): HumanReviewCaseUpdate | null {
  const humanReviewStatus = HUMAN_REVIEW_CASE_STATUS_BY_SERVICE[serviceType];

  if (!humanReviewStatus) {
    return null;
  }

  return {
    human_review_requested: true,
    human_review_status: humanReviewStatus,
    status: "waiting_human_review"
  };
}

export function getRequestOrigin(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

function applyOneTimeLineItem(params: URLSearchParams, service: ConfiguredOneTimeService) {
  params.set("line_items[0][quantity]", "1");

  if (service.stripePriceId) {
    params.set("line_items[0][price]", service.stripePriceId);
    return;
  }

  params.set("line_items[0][price_data][currency]", "brl");
  params.set("line_items[0][price_data][unit_amount]", String(service.priceCents));

  if (service.stripeProductId) {
    params.set("line_items[0][price_data][product]", service.stripeProductId);
    return;
  }

  params.set("line_items[0][price_data][product_data][name]", service.label);
  params.set("line_items[0][price_data][product_data][metadata][serviceType]", service.serviceType);
}

async function postCheckoutSession(params: URLSearchParams) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error("Configure STRIPE_SECRET_KEY para criar o checkout do Stripe.");
  }

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

  if (!response.ok || !session?.id || !session.url) {
    throw new Error(session?.error?.message || "Não foi possível iniciar o checkout do Stripe.");
  }

  return session;
}

export async function createStripeCheckoutSession(
  request: NextRequest,
  orderId: string,
  userId: string,
  caseId: string,
  serviceType: HumanReviewServiceType,
  service: ConfiguredOneTimeService
) {
  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/checkout/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancelado`,
    client_reference_id: orderId,
    "metadata[userId]": userId,
    "metadata[caseId]": caseId,
    "metadata[orderId]": orderId,
    "metadata[serviceType]": serviceType,
    "payment_intent_data[metadata][userId]": userId,
    "payment_intent_data[metadata][caseId]": caseId,
    "payment_intent_data[metadata][orderId]": orderId,
    "payment_intent_data[metadata][serviceType]": serviceType
  });

  applyOneTimeLineItem(params, service);

  return postCheckoutSession(params);
}

/**
 * Checkout do Parecer Técnico Avulso. Não exige caso previo: o webhook libera
 * exatamente 1 crédito de demanda técnica após a confirmação do pagamento.
 */
export async function createTechnicalOpinionCheckoutSession(
  request: NextRequest,
  orderId: string,
  userId: string,
  service: ConfiguredOneTimeService
) {
  const origin = getRequestOrigin(request);
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/checkout/sucesso?session_id={CHECKOUT_SESSION_ID}&tipo=parecer`,
    cancel_url: `${origin}/checkout/cancelado`,
    client_reference_id: orderId,
    "metadata[userId]": userId,
    "metadata[orderId]": orderId,
    "metadata[serviceType]": TECHNICAL_OPINION_SERVICE_TYPE,
    "payment_intent_data[metadata][userId]": userId,
    "payment_intent_data[metadata][orderId]": orderId,
    "payment_intent_data[metadata][serviceType]": TECHNICAL_OPINION_SERVICE_TYPE
  });

  applyOneTimeLineItem(params, service);

  return postCheckoutSession(params);
}

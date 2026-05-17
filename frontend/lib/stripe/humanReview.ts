import { NextRequest } from "next/server";

export type HumanReviewServiceType = "human_case_review" | "soil_analysis_review" | "technical_report" | "monthly_farm_followup";

export type StripeCheckoutSession = {
  id?: string;
  url?: string;
  payment_status?: string;
  metadata?: Record<string, string | undefined> | null;
  error?: {
    message?: string;
  };
};

export type OneTimeOrder = {
  id: string;
  case_id?: string | null;
  user_id?: string | null;
  service_type?: string | null;
  payment_status?: string | null;
};

export type HumanReviewCaseUpdate = {
  human_review_requested: boolean;
  human_review_status: "waiting_review" | "waiting_soil_review" | "waiting_technical_report";
  status: "waiting_human_review";
};

export const HUMAN_REVIEW_SERVICES: Record<HumanReviewServiceType, { label: string; priceCents: number }> = {
  human_case_review: { label: "Revisão humana de caso agronômico", priceCents: 19700 },
  soil_analysis_review: { label: "Revisão de análise de solo", priceCents: 25000 },
  technical_report: { label: "Relatório técnico agronômico", priceCents: 49700 },
  monthly_farm_followup: { label: "Acompanhamento mensal da fazenda", priceCents: 99700 }
};

const HUMAN_REVIEW_CASE_STATUS_BY_SERVICE: Partial<Record<HumanReviewServiceType, HumanReviewCaseUpdate["human_review_status"]>> = {
  human_case_review: "waiting_review",
  soil_analysis_review: "waiting_soil_review",
  technical_report: "waiting_technical_report"
};

export function isHumanReviewServiceType(value: unknown): value is HumanReviewServiceType {
  return typeof value === "string" && value in HUMAN_REVIEW_SERVICES;
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

export function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para processar pagamentos.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey };
}

export async function supabaseAdminRequest<T>(path: string, init: RequestInit, config = getSupabaseAdminConfig()) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || "Erro ao comunicar com o Supabase.");
  }

  return payload as T;
}

export async function createStripeCheckoutSession(
  request: NextRequest,
  orderId: string,
  userId: string,
  caseId: string,
  serviceType: HumanReviewServiceType
) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error("Configure STRIPE_SECRET_KEY para criar o checkout do Stripe.");
  }

  const origin = getRequestOrigin(request);
  const service = HUMAN_REVIEW_SERVICES[serviceType];
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/meus-relatorios?payment=success`,
    cancel_url: `${origin}/revisao-humana?caseId=${encodeURIComponent(caseId)}&payment=cancelled`,
    client_reference_id: orderId,
    "line_items[0][price_data][currency]": "brl",
    "line_items[0][price_data][unit_amount]": String(service.priceCents),
    "line_items[0][price_data][product_data][name]": service.label,
    "line_items[0][quantity]": "1",
    "metadata[userId]": userId,
    "metadata[caseId]": caseId,
    "metadata[orderId]": orderId,
    "metadata[serviceType]": serviceType,
    "payment_intent_data[metadata][userId]": userId,
    "payment_intent_data[metadata][caseId]": caseId,
    "payment_intent_data[metadata][orderId]": orderId,
    "payment_intent_data[metadata][serviceType]": serviceType
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

  if (!response.ok || !session?.id || !session.url) {
    throw new Error(session?.error?.message || "Não foi possível iniciar o checkout do Stripe.");
  }

  return session;
}

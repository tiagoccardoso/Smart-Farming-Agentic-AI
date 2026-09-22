/**
 * Direitos (entitlements) dos planos PlantaSa.
 *
 * Regra do projeto: NAO espalhar `if (plan === "consultoria") limit = 3` pelo
 * sistema. Toda decisao de liberacao consulta os direitos resolvidos aqui, que
 * vem da coluna `plans.entitlements` (editavel pela area administrativa).
 * Trocar "3 pareceres" por "5 pareceres" e uma alteracao de dado, nao de codigo.
 */

import { supabaseAdminRequest } from "../server/supabaseAdmin";
import {
  InternalSubscriptionState,
  isSubscriptionEntitled,
  mapStripeSubscriptionStatus
} from "./subscription-state";

export const FREE_PLAN_CODE = "gratuito";
export const PROFESSIONAL_PLAN_CODE = "ia-profissional";
export const CONSULTING_PLAN_CODE = "consultoria-agronomica";
export const QUOTE_PLAN_CODE = "presencial-projetos";

/** Planos que podem ser assinados via Stripe (billing recorrente). */
export const SUBSCRIBABLE_PLAN_CODES = [PROFESSIONAL_PLAN_CODE, CONSULTING_PLAN_CODE] as const;
export type SubscribablePlanCode = (typeof SUBSCRIBABLE_PLAN_CODES)[number];

export type Entitlements = {
  /** null = sem teto numerico (sujeito a politica de uso). */
  AI_MONTHLY_LIMIT: number | null;
  AI_IMAGES: boolean;
  REPORTS: boolean;
  PROPERTY_HISTORY: boolean;
  TECHNICAL_OPINIONS_MONTHLY: number;
  HUMAN_VALIDATION: boolean;
  CASE_ANALYSIS_MONTHLY: number | null;
  IMAGE_TRIAGE_MONTHLY: number | null;
  SOIL_ANALYSIS_UPLOAD: boolean;
};

export type PlanRecord = {
  id: string;
  name: string | null;
  slug: string | null;
  price_cents: number | null;
  billing_type: string | null;
  plan_kind?: string | null;
  stripe_product_id?: string | null;
  stripe_price_id: string | null;
  entitlements?: unknown;
  is_legacy?: boolean | null;
  legacy_entitlement_code?: string | null;
  active: boolean | null;
};

export type ResolvedSubscription = {
  id: string;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  state: InternalSubscriptionState;
  entitled: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceCents: number | null;
};

export type ResolvedAccess = {
  userId: string;
  planCode: string;
  planId: string | null;
  planName: string;
  entitlements: Entitlements;
  unlimitedAccess: boolean;
  profileActive: boolean;
  subscription: ResolvedSubscription | null;
  /** Plano legado preservado: o assinante mantem a cobranca antiga. */
  legacyPlanCode: string | null;
};

/**
 * Usado apenas quando a tabela `plans` ainda nao tem o plano (ambiente novo ou
 * migration nao aplicada). A fonte de verdade e sempre o banco.
 */
const FALLBACK_ENTITLEMENTS: Record<string, Entitlements> = {
  [FREE_PLAN_CODE]: {
    AI_MONTHLY_LIMIT: 3,
    AI_IMAGES: false,
    REPORTS: false,
    PROPERTY_HISTORY: false,
    TECHNICAL_OPINIONS_MONTHLY: 0,
    HUMAN_VALIDATION: false,
    CASE_ANALYSIS_MONTHLY: 1,
    IMAGE_TRIAGE_MONTHLY: 0,
    SOIL_ANALYSIS_UPLOAD: false
  },
  [PROFESSIONAL_PLAN_CODE]: {
    AI_MONTHLY_LIMIT: 300,
    AI_IMAGES: true,
    REPORTS: true,
    PROPERTY_HISTORY: true,
    TECHNICAL_OPINIONS_MONTHLY: 0,
    HUMAN_VALIDATION: false,
    CASE_ANALYSIS_MONTHLY: 300,
    IMAGE_TRIAGE_MONTHLY: 300,
    SOIL_ANALYSIS_UPLOAD: true
  },
  [CONSULTING_PLAN_CODE]: {
    AI_MONTHLY_LIMIT: 300,
    AI_IMAGES: true,
    REPORTS: true,
    PROPERTY_HISTORY: true,
    TECHNICAL_OPINIONS_MONTHLY: 3,
    HUMAN_VALIDATION: true,
    CASE_ANALYSIS_MONTHLY: 300,
    IMAGE_TRIAGE_MONTHLY: 300,
    SOIL_ANALYSIS_UPLOAD: true
  }
};

export const UNLIMITED_ENTITLEMENTS: Entitlements = {
  AI_MONTHLY_LIMIT: null,
  AI_IMAGES: true,
  REPORTS: true,
  PROPERTY_HISTORY: true,
  TECHNICAL_OPINIONS_MONTHLY: Number.MAX_SAFE_INTEGER,
  HUMAN_VALIDATION: true,
  CASE_ANALYSIS_MONTHLY: null,
  IMAGE_TRIAGE_MONTHLY: null,
  SOIL_ANALYSIS_UPLOAD: true
};

function toLimit(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toCount(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeEntitlements(raw: unknown, planCode = FREE_PLAN_CODE): Entitlements {
  const fallback = FALLBACK_ENTITLEMENTS[planCode] ?? FALLBACK_ENTITLEMENTS[FREE_PLAN_CODE];
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  return {
    AI_MONTHLY_LIMIT: toLimit(source.AI_MONTHLY_LIMIT, fallback.AI_MONTHLY_LIMIT),
    AI_IMAGES: toFlag(source.AI_IMAGES, fallback.AI_IMAGES),
    REPORTS: toFlag(source.REPORTS, fallback.REPORTS),
    PROPERTY_HISTORY: toFlag(source.PROPERTY_HISTORY, fallback.PROPERTY_HISTORY),
    TECHNICAL_OPINIONS_MONTHLY: toCount(source.TECHNICAL_OPINIONS_MONTHLY, fallback.TECHNICAL_OPINIONS_MONTHLY),
    HUMAN_VALIDATION: toFlag(source.HUMAN_VALIDATION, fallback.HUMAN_VALIDATION),
    CASE_ANALYSIS_MONTHLY: toLimit(source.CASE_ANALYSIS_MONTHLY, fallback.CASE_ANALYSIS_MONTHLY),
    IMAGE_TRIAGE_MONTHLY: toLimit(source.IMAGE_TRIAGE_MONTHLY, fallback.IMAGE_TRIAGE_MONTHLY),
    SOIL_ANALYSIS_UPLOAD: toFlag(source.SOIL_ANALYSIS_UPLOAD, fallback.SOIL_ANALYSIS_UPLOAD)
  };
}

const PLAN_SELECT =
  "id,name,slug,price_cents,billing_type,plan_kind,stripe_product_id,stripe_price_id,entitlements,is_legacy,legacy_entitlement_code,active";

export async function fetchPlanByCode(code: string, requireActive = false) {
  const activeFilter = requireActive ? "&active=eq.true" : "";
  const plans = await supabaseAdminRequest<PlanRecord[]>(
    `/rest/v1/plans?slug=eq.${encodeURIComponent(code)}${activeFilter}&select=${PLAN_SELECT}&limit=1`,
    { method: "GET" }
  );

  return plans[0] ?? null;
}

/**
 * Plano cobrado pelo Stripe. So aceita planos recorrentes ativos, para que a
 * desativacao de um plano na area administrativa realmente pare novas vendas.
 */
export async function fetchSubscribablePlan(code: string) {
  const plan = await fetchPlanByCode(code, true);

  if (!plan || plan.billing_type !== "monthly" || !plan.price_cents || plan.price_cents <= 0) {
    throw new Error("Plano mensal nao encontrado ou inativo.");
  }

  return plan;
}

export function isSubscribablePlanCode(value: unknown): value is SubscribablePlanCode {
  return typeof value === "string" && (SUBSCRIBABLE_PLAN_CODES as readonly string[]).includes(value);
}

type ProfileAccessRow = {
  status: "active" | "inactive" | null;
  unlimited_access: boolean | null;
};

type SubscriptionRow = {
  id: string;
  plan_id: string | null;
  status: string | null;
  internal_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  plans: PlanRecord | null;
};

const SUBSCRIPTION_SELECT =
  `id,plan_id,status,internal_status,stripe_customer_id,stripe_subscription_id,stripe_price_id,current_period_start,current_period_end,cancel_at_period_end,plans(${PLAN_SELECT})`;

function toResolvedSubscription(row: SubscriptionRow): ResolvedSubscription {
  const cancelAtPeriodEnd = Boolean(row.cancel_at_period_end);
  const state = (row.internal_status as InternalSubscriptionState | null) ??
    mapStripeSubscriptionStatus(row.status, cancelAtPeriodEnd);

  return {
    id: row.id,
    planId: row.plan_id,
    planCode: row.plans?.slug ?? null,
    planName: row.plans?.name ?? null,
    state,
    entitled: isSubscriptionEntitled(state, row.current_period_end),
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd,
    priceCents: row.plans?.price_cents ?? null
  };
}

export async function listUserSubscriptions(userId: string) {
  const rows = await supabaseAdminRequest<SubscriptionRow[]>(
    `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=${SUBSCRIPTION_SELECT}&order=created_at.desc&limit=20`,
    { method: "GET" }
  );

  return rows.map(toResolvedSubscription);
}

async function loadProfileAccess(userId: string) {
  const profiles = await supabaseAdminRequest<ProfileAccessRow[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=status,unlimited_access&limit=1`,
    { method: "GET" }
  );

  return profiles[0] ?? { status: "active" as const, unlimited_access: false };
}

/**
 * Resolve o que o usuario pode fazer AGORA.
 *
 * Ordem: perfil inativo -> sem direitos; acesso ilimitado -> tudo; assinatura
 * com estado que da direito -> direitos do plano (ou do plano-alvo, se o plano
 * for legado); caso contrario -> plano Gratuito.
 */
export async function resolveUserAccess(userId: string): Promise<ResolvedAccess> {
  const [profile, subscriptionRows] = await Promise.all([
    loadProfileAccess(userId),
    supabaseAdminRequest<SubscriptionRow[]>(
      `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=${SUBSCRIPTION_SELECT}&order=created_at.desc&limit=20`,
      { method: "GET" }
    )
  ]);

  const profileActive = (profile.status ?? "active") === "active";
  const unlimitedAccess = Boolean(profile.unlimited_access);
  const subscriptions = subscriptionRows.map(toResolvedSubscription);
  const entitledRow = subscriptionRows.find((row) => toResolvedSubscription(row).entitled) ?? null;
  const activeSubscription = subscriptions.find((subscription) => subscription.entitled) ?? subscriptions[0] ?? null;

  if (unlimitedAccess) {
    return {
      userId,
      planCode: entitledRow?.plans?.slug ?? FREE_PLAN_CODE,
      planId: entitledRow?.plan_id ?? null,
      planName: "Acesso ilimitado",
      entitlements: UNLIMITED_ENTITLEMENTS,
      unlimitedAccess: true,
      profileActive,
      subscription: activeSubscription,
      legacyPlanCode: null
    };
  }

  if (entitledRow?.plans) {
    const plan = entitledRow.plans;
    const planCode = plan.slug ?? FREE_PLAN_CODE;

    // Plano legado: a cobranca antiga e preservada, mas os direitos passam a
    // ser os do plano novo equivalente.
    if (plan.is_legacy && plan.legacy_entitlement_code) {
      const target = await fetchPlanByCode(plan.legacy_entitlement_code).catch(() => null);

      if (target) {
        return {
          userId,
          planCode: target.slug ?? planCode,
          planId: plan.id,
          planName: plan.name ?? target.name ?? planCode,
          entitlements: normalizeEntitlements(target.entitlements, target.slug ?? planCode),
          unlimitedAccess: false,
          profileActive,
          subscription: activeSubscription,
          legacyPlanCode: planCode
        };
      }
    }

    return {
      userId,
      planCode,
      planId: plan.id,
      planName: plan.name ?? planCode,
      entitlements: normalizeEntitlements(plan.entitlements, planCode),
      unlimitedAccess: false,
      profileActive,
      subscription: activeSubscription,
      legacyPlanCode: plan.is_legacy ? planCode : null
    };
  }

  const freePlan = await fetchPlanByCode(FREE_PLAN_CODE).catch(() => null);

  return {
    userId,
    planCode: FREE_PLAN_CODE,
    planId: freePlan?.id ?? null,
    planName: freePlan?.name ?? "PlantaSa Gratuito",
    entitlements: normalizeEntitlements(freePlan?.entitlements, FREE_PLAN_CODE),
    unlimitedAccess: false,
    profileActive,
    subscription: activeSubscription,
    legacyPlanCode: null
  };
}

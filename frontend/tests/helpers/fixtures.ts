/** Linhas de banco usadas pelos testes, no mesmo formato do PostgREST. */

export const FREE_PLAN_ROW = {
  id: "plan-free",
  name: "PlantaSa Gratuito",
  slug: "gratuito",
  price_cents: 0,
  billing_type: "free",
  plan_kind: "free",
  stripe_product_id: null,
  stripe_price_id: null,
  entitlements: {
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
  is_legacy: false,
  legacy_entitlement_code: null,
  active: true
};

export const PROFESSIONAL_PLAN_ROW = {
  id: "plan-pro",
  name: "PlantaSa IA Profissional",
  slug: "ia-profissional",
  price_cents: 9700,
  billing_type: "monthly",
  plan_kind: "subscription",
  stripe_product_id: null,
  stripe_price_id: null,
  entitlements: {
    AI_MONTHLY_LIMIT: 300,
    AI_IMAGES: true,
    REPORTS: true,
    PROPERTY_HISTORY: true,
    TECHNICAL_OPINIONS_MONTHLY: 1,
    HUMAN_VALIDATION: true,
    CASE_ANALYSIS_MONTHLY: 300,
    IMAGE_TRIAGE_MONTHLY: 300,
    SOIL_ANALYSIS_UPLOAD: true
  },
  is_legacy: false,
  legacy_entitlement_code: null,
  active: true
};

export const CONSULTING_PLAN_ROW = {
  id: "plan-consultoria",
  name: "PlantaSa Consultoria Agronômica",
  slug: "consultoria-agronomica",
  price_cents: 49700,
  billing_type: "monthly",
  plan_kind: "subscription",
  stripe_product_id: null,
  stripe_price_id: null,
  entitlements: {
    AI_MONTHLY_LIMIT: 300,
    AI_IMAGES: true,
    REPORTS: true,
    PROPERTY_HISTORY: true,
    TECHNICAL_OPINIONS_MONTHLY: 3,
    HUMAN_VALIDATION: true,
    CASE_ANALYSIS_MONTHLY: 300,
    IMAGE_TRIAGE_MONTHLY: 300,
    SOIL_ANALYSIS_UPLOAD: true
  },
  is_legacy: false,
  legacy_entitlement_code: null,
  active: true
};

/** Plano antigo preservado: continua cobrando R$ 397, direitos migrados. */
export const LEGACY_PLAN_ROW = {
  ...CONSULTING_PLAN_ROW,
  id: "plan-legado",
  name: "IA + Revisao Humana",
  slug: "ia-revisao-humana",
  price_cents: 39700,
  is_legacy: true,
  legacy_entitlement_code: "consultoria-agronomica",
  active: false
};

export function subscriptionRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();

  return {
    id: "sub-1",
    plan_id: CONSULTING_PLAN_ROW.id,
    status: "active",
    internal_status: "active",
    stripe_customer_id: "cus_teste",
    stripe_subscription_id: "sub_stripe_teste",
    stripe_price_id: "price_teste",
    current_period_start: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    current_period_end: new Date(now + 25 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: false,
    plans: CONSULTING_PLAN_ROW,
    ...overrides
  };
}

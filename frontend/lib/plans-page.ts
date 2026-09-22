export type PlanPageSettings = {
  id: boolean;
  eyebrow: string;
  title: string;
  subtitle: string;
  intro: string;
  value_phrases: string[];
  strategy_label: string;
  strategy_title: string;
  strategy_items: string[];
  legal_notice: string;
  free_plan_notice: string;
  comparison_label: string;
  comparison_description: string;
  consulting_eyebrow: string;
  consulting_title: string;
  consulting_description: string;
  consulting_notice: string;
  /** Bloco "Precisa de atendimento pontual?" (parecer tecnico avulso). */
  onetime_title: string;
  onetime_description: string;
  onetime_button_label: string;
  /** Presencial & Projetos Especiais. */
  quote_button_label: string;
  quote_services: string[];
  updated_at?: string | null;
};

/** Direitos configuraveis do plano. Fonte unica das regras comerciais. */
export type PlanEntitlements = {
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

export type PlanKind = "free" | "subscription" | "quote";

export type PlanPagePlan = {
  id: string;
  name: string;
  slug: string;
  eyebrow: string;
  audience: string;
  description: string;
  price_cents: number;
  billing_type: string | null;
  plan_kind: PlanKind | string | null;
  price_prefix: string;
  price_period: string;
  price_note: string;
  features: string[];
  exclusions: string[];
  button_label: string;
  highlighted: boolean;
  badge: string | null;
  active: boolean;
  display_order: number;
  entitlements?: PlanEntitlements | null;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  is_legacy?: boolean | null;
  updated_at?: string | null;
};

export type PlanPageService = {
  service_type: string;
  name: string;
  price_cents: number;
  price_prefix: string;
  price_period: string;
  description: string;
  button_label: string;
  active: boolean;
  display_order: number;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  updated_at?: string | null;
};

export type PlansPagePayload = {
  settings: PlanPageSettings;
  plans: PlanPagePlan[];
  services: PlanPageService[];
};

export const TECHNICAL_OPINION_SERVICE_TYPE = "technical_opinion_single";
export const FREE_PLAN_CODE = "gratuito";
export const QUOTE_PLAN_CODE = "presencial-projetos";

export function isQuotePlan(plan: PlanPagePlan) {
  return plan.plan_kind === "quote" || plan.billing_type === "quote" || plan.slug === QUOTE_PLAN_CODE;
}

export function isFreePlan(plan: PlanPagePlan) {
  return plan.plan_kind === "free" || plan.slug === FREE_PLAN_CODE || plan.price_cents === 0;
}

const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Planos sob consulta nunca exibem preco ficticio. */
export function formatPlanPrice(plan: PlanPagePlan) {
  if (isQuotePlan(plan)) {
    return plan.price_note?.trim() || "Sob consulta";
  }

  const label = `${plan.price_prefix ? `${plan.price_prefix} ` : ""}${brlFormatter.format(plan.price_cents / 100)}`;
  return plan.price_period ? `${label}/${plan.price_period}` : label;
}

export function formatServicePrice(service: PlanPageService) {
  const label = `${service.price_prefix ? `${service.price_prefix} ` : ""}${brlFormatter.format(service.price_cents / 100)}`;
  return service.price_period ? `${label}/${service.price_period}` : label;
}

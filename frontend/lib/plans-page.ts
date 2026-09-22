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
  updated_at?: string | null;
};

export type PlanPagePlan = {
  id: string;
  name: string;
  slug: string;
  eyebrow: string;
  audience: string;
  description: string;
  price_cents: number;
  billing_type: string | null;
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
  stripe_price_id?: string | null;
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
  updated_at?: string | null;
};

export type PlansPagePayload = {
  settings: PlanPageSettings;
  plans: PlanPagePlan[];
  services: PlanPageService[];
};

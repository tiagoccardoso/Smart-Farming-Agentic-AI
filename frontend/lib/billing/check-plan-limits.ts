export type UsageEventType = "ai_question" | "case_analysis" | "image_triage" | "pdf_report" | "human_review";

export type PlanFeature = "photo_upload" | "soil_analysis_upload" | "simple_history";

type PlanSlug = "gratuito" | "ia-basica" | "ia-profissional" | "ia-revisao-humana";

type UsageLimit = number | null;

type PlanRules = {
  label: string;
  limits: Record<UsageEventType, UsageLimit>;
  features: Record<PlanFeature, boolean>;
};

type SupabaseAdminConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type SubscriptionWithPlan = {
  id: string;
  status: string | null;
  current_period_end: string | null;
  plans: { slug: string | null; name: string | null } | null;
};

type UsageEventRow = {
  count: number | null;
};

export type PlanLimitCheckResult = {
  allowed: boolean;
  userId: string;
  planSlug: PlanSlug;
  planLabel: string;
  eventType: UsageEventType;
  limit: UsageLimit;
  used: number;
  remaining: UsageLimit;
  periodStart: string;
  periodEnd: string;
};

export const PLAN_LIMIT_REACHED_MESSAGE = "Você atingiu o limite do seu plano. Faça upgrade para continuar.";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const PLAN_RULES: Record<PlanSlug, PlanRules> = {
  gratuito: {
    label: "Plano Gratuito",
    limits: {
      ai_question: 3,
      case_analysis: 1,
      image_triage: 1,
      pdf_report: 0,
      human_review: 0
    },
    features: {
      photo_upload: false,
      soil_analysis_upload: false,
      simple_history: false
    }
  },
  "ia-basica": {
    label: "IA Básica",
    limits: {
      ai_question: 50,
      case_analysis: 50,
      image_triage: 0,
      pdf_report: 0,
      human_review: 0
    },
    features: {
      photo_upload: false,
      soil_analysis_upload: false,
      simple_history: true
    }
  },
  "ia-profissional": {
    label: "IA Profissional",
    limits: {
      ai_question: 300,
      case_analysis: 300,
      image_triage: 300,
      pdf_report: 300,
      human_review: 0
    },
    features: {
      photo_upload: true,
      soil_analysis_upload: true,
      simple_history: true
    }
  },
  "ia-revisao-humana": {
    label: "IA + Revisão Humana",
    limits: {
      ai_question: 300,
      case_analysis: 300,
      image_triage: 300,
      pdf_report: 300,
      human_review: 1
    },
    features: {
      photo_upload: true,
      soil_analysis_upload: true,
      simple_history: true
    }
  }
};

export class PlanLimitExceededError extends Error {
  status: number;
  result?: PlanLimitCheckResult;

  constructor(result?: PlanLimitCheckResult) {
    super(PLAN_LIMIT_REACHED_MESSAGE);
    this.name = "PlanLimitExceededError";
    this.status = 402;
    this.result = result;
  }
}

export class PlanFeatureUnavailableError extends Error {
  status: number;

  constructor(message = PLAN_LIMIT_REACHED_MESSAGE) {
    super(message);
    this.name = "PlanFeatureUnavailableError";
    this.status = 402;
  }
}

function getSupabaseAdminConfig(): SupabaseAdminConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para controlar limites de uso.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey };
}

async function supabaseAdminRequest<T>(path: string, init: RequestInit, config = getSupabaseAdminConfig()) {
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

function getCurrentMonthlyPeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function normalizePlanSlug(value: string | null | undefined): PlanSlug {
  return value && value in PLAN_RULES ? (value as PlanSlug) : "gratuito";
}

function isSubscriptionActive(subscription: SubscriptionWithPlan, now = new Date()) {
  if (!subscription.status || !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }

  if (!subscription.current_period_end) {
    return true;
  }

  return new Date(subscription.current_period_end).getTime() > now.getTime();
}

async function getUserPlanSlug(userId: string) {
  const subscriptions = await supabaseAdminRequest<SubscriptionWithPlan[]>(
    `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=id,status,current_period_end,plans(slug,name)&order=created_at.desc&limit=10`,
    { method: "GET" }
  );
  const activeSubscription = subscriptions.find((subscription) => isSubscriptionActive(subscription));

  return normalizePlanSlug(activeSubscription?.plans?.slug);
}

async function getUsageCount(userId: string, eventType: UsageEventType, periodStart: string, periodEnd: string) {
  const events = await supabaseAdminRequest<UsageEventRow[]>(
    `/rest/v1/usage_events?user_id=eq.${encodeURIComponent(userId)}&event_type=eq.${encodeURIComponent(eventType)}&period_start=eq.${encodeURIComponent(periodStart)}&period_end=eq.${encodeURIComponent(periodEnd)}&select=count`,
    { method: "GET" }
  );

  return events.reduce((total, event) => total + (event.count ?? 0), 0);
}

export async function getPlanLimitCheck(userId: string, eventType: UsageEventType, incrementBy = 1): Promise<PlanLimitCheckResult> {
  const normalizedIncrement = Math.max(1, Math.floor(incrementBy));
  const planSlug = await getUserPlanSlug(userId);
  const rules = PLAN_RULES[planSlug];
  const { periodStart, periodEnd } = getCurrentMonthlyPeriod();
  const used = await getUsageCount(userId, eventType, periodStart, periodEnd);
  const limit = rules.limits[eventType];
  const allowed = limit === null || used + normalizedIncrement <= limit;

  return {
    allowed,
    userId,
    planSlug,
    planLabel: rules.label,
    eventType,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart,
    periodEnd
  };
}

export async function assertPlanLimit(userId: string, eventType: UsageEventType, incrementBy = 1) {
  const result = await getPlanLimitCheck(userId, eventType, incrementBy);

  if (!result.allowed) {
    throw new PlanLimitExceededError(result);
  }

  return result;
}

export async function recordUsageEvent(userId: string, eventType: UsageEventType, count = 1) {
  const normalizedCount = Math.max(1, Math.floor(count));
  const { periodStart, periodEnd } = getCurrentMonthlyPeriod();

  await supabaseAdminRequest(
    "/rest/v1/usage_events",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        event_type: eventType,
        count: normalizedCount,
        period_start: periodStart,
        period_end: periodEnd
      })
    }
  );
}

export async function checkAndRecordUsageEvent(userId: string, eventType: UsageEventType, count = 1) {
  const result = await assertPlanLimit(userId, eventType, count);
  await recordUsageEvent(userId, eventType, count);
  return result;
}

export async function assertPlanFeature(userId: string, feature: PlanFeature) {
  const planSlug = await getUserPlanSlug(userId);

  if (!PLAN_RULES[planSlug].features[feature]) {
    throw new PlanFeatureUnavailableError();
  }

  return { userId, planSlug, planLabel: PLAN_RULES[planSlug].label, feature };
}

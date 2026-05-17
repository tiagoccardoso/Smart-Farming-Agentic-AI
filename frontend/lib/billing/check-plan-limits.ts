export type UsageEventType = "ai_question" | "case_analysis" | "image_triage" | "pdf_report" | "human_review";

export type PlanFeature = "photo_upload" | "soil_analysis_upload" | "simple_history";
export type QuestionHistorySource = "qa" | "agronomic_case";

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

type UserAccessProfile = {
  status: "active" | "inactive" | null;
  unlimited_access: boolean | null;
};

type QuestionHistoryInput = {
  userId: string;
  question: string;
  answer?: string | null;
  source?: QuestionHistorySource;
  caseId?: string | null;
};

export type QuestionHistoryEntry = {
  id: string;
  case_id: string | null;
  source: QuestionHistorySource;
  question: string;
  answer: string | null;
  created_at: string | null;
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
  unlimitedAccess?: boolean;
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
      simple_history: true
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

export class UserInactiveError extends Error {
  status: number;

  constructor(message = "Usuário inativo. Entre em contato com o suporte.") {
    super(message);
    this.name = "UserInactiveError";
    this.status = 403;
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

async function getUserAccessProfile(userId: string) {
  const profiles = await supabaseAdminRequest<UserAccessProfile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=status,unlimited_access&limit=1`,
    { method: "GET" }
  );

  return profiles[0] ?? { status: "active", unlimited_access: false };
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
  const accessProfile = await getUserAccessProfile(userId);

  if ((accessProfile.status ?? "active") !== "active") {
    throw new UserInactiveError();
  }

  const planSlug = await getUserPlanSlug(userId);
  const rules = PLAN_RULES[planSlug];
  const { periodStart, periodEnd } = getCurrentMonthlyPeriod();
  const used = await getUsageCount(userId, eventType, periodStart, periodEnd);
  const limit = accessProfile.unlimited_access ? null : rules.limits[eventType];
  const allowed = accessProfile.unlimited_access || limit === null || used + normalizedIncrement <= limit;

  return {
    allowed,
    userId,
    planSlug,
    planLabel: accessProfile.unlimited_access ? "Acesso ilimitado" : rules.label,
    eventType,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart,
    periodEnd,
    unlimitedAccess: Boolean(accessProfile.unlimited_access)
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

export async function getQuestionHistory(userId: string, source?: QuestionHistorySource, limit = 25) {
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const sourceFilter = source ? `&source=eq.${encodeURIComponent(source)}` : "";

  return supabaseAdminRequest<QuestionHistoryEntry[]>(
    `/rest/v1/ai_question_history?user_id=eq.${encodeURIComponent(userId)}${sourceFilter}&select=id,case_id,source,question,answer,created_at&order=created_at.desc&limit=${normalizedLimit}`,
    { method: "GET" }
  );
}

export async function recordQuestionHistory(input: QuestionHistoryInput) {
  const question = input.question.trim();

  if (question.length < 3) {
    return;
  }

  await supabaseAdminRequest(
    "/rest/v1/ai_question_history",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: input.userId,
        case_id: input.caseId ?? null,
        source: input.source ?? "qa",
        question,
        answer: input.answer ?? null
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
  const accessProfile = await getUserAccessProfile(userId);

  if ((accessProfile.status ?? "active") !== "active") {
    throw new UserInactiveError();
  }

  const planSlug = await getUserPlanSlug(userId);

  if (accessProfile.unlimited_access) {
    return { userId, planSlug, planLabel: "Acesso ilimitado", feature, unlimitedAccess: true };
  }

  if (!PLAN_RULES[planSlug].features[feature]) {
    throw new PlanFeatureUnavailableError();
  }

  return { userId, planSlug, planLabel: PLAN_RULES[planSlug].label, feature, unlimitedAccess: false };
}

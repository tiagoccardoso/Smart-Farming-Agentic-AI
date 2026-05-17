import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";

type AdminProfile = {
  role: "client" | "specialist" | "admin";
};

type CaseRow = {
  id: string;
  user_id: string | null;
  crop: string | null;
  status: string | null;
  risk_level: "low" | "medium" | "high" | null;
  human_review_requested: boolean | null;
  human_review_status: string | null;
  soil_analysis_url: string | null;
  created_at: string | null;
  farm_id: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type FarmRow = {
  id: string;
  name: string | null;
};

type SubscriptionWithPlan = {
  user_id: string;
  status: string | null;
  current_period_end: string | null;
  created_at: string | null;
  plans: { slug: string | null; name: string | null } | null;
};

type UsageEventRow = {
  user_id: string;
  event_type: UsageEventType | null;
  count: number | null;
};

type PlanSlug = "gratuito" | "ia-basica" | "ia-profissional" | "ia-revisao-humana";
type UsageEventType = "ai_question" | "case_analysis" | "image_triage" | "pdf_report" | "human_review";
type UsageLimit = number | null;

type PlanSummary = {
  slug: PlanSlug;
  label: string;
};

type CommercialOpportunity = {
  id: string;
  caseId: string;
  userId: string | null;
  userName: string;
  crop: string;
  risk: "low" | "medium" | "high" | null;
  currentPlan: string;
  caseStatus: string;
  suggestedOffer: string;
  reasons: string[];
  farmName: string;
  createdAt: string | null;
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const PLAN_LABELS: Record<PlanSlug, string> = {
  gratuito: "Plano Gratuito",
  "ia-basica": "IA Básica",
  "ia-profissional": "IA Profissional",
  "ia-revisao-humana": "IA + Revisão Humana"
};
const PLAN_LIMITS: Record<PlanSlug, Record<UsageEventType, UsageLimit>> = {
  gratuito: {
    ai_question: 3,
    case_analysis: 1,
    image_triage: 1,
    pdf_report: 0,
    human_review: 0
  },
  "ia-basica": {
    ai_question: 50,
    case_analysis: 50,
    image_triage: 0,
    pdf_report: 0,
    human_review: 0
  },
  "ia-profissional": {
    ai_question: 300,
    case_analysis: 300,
    image_triage: 300,
    pdf_report: 300,
    human_review: 0
  },
  "ia-revisao-humana": {
    ai_question: 300,
    case_analysis: 300,
    image_triage: 300,
    pdf_report: 300,
    human_review: 1
  }
};

function buildInFilter(values: string[]) {
  return `in.(${values.map(encodeURIComponent).join(",")})`;
}

function getCurrentMonthlyPeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para listar oportunidades comerciais.");
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

async function getAdminProfile(token: string, userId: string) {
  const profiles = await supabaseRequest<AdminProfile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`,
    { method: "GET" },
    token
  );

  return profiles[0] ?? null;
}

function normalizePlanSlug(value?: string | null): PlanSlug {
  return value && value in PLAN_LABELS ? (value as PlanSlug) : "gratuito";
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

function getPlanSummaries(userIds: string[], subscriptions: SubscriptionWithPlan[]) {
  const planByUser = new Map<string, PlanSummary>();

  userIds.forEach((userId) => {
    const activeSubscription = subscriptions.filter((subscription) => subscription.user_id === userId).find((subscription) => isSubscriptionActive(subscription));
    const slug = normalizePlanSlug(activeSubscription?.plans?.slug);
    planByUser.set(userId, { slug, label: activeSubscription?.plans?.name || PLAN_LABELS[slug] });
  });

  return planByUser;
}

function getLimitReachedUsers(planByUser: Map<string, PlanSummary>, usageEvents: UsageEventRow[]) {
  const usageByUserAndEvent = new Map<string, number>();

  usageEvents.forEach((event) => {
    if (!event.event_type) {
      return;
    }

    const key = `${event.user_id}:${event.event_type}`;
    usageByUserAndEvent.set(key, (usageByUserAndEvent.get(key) ?? 0) + (event.count ?? 0));
  });

  const reachedUsers = new Set<string>();

  planByUser.forEach((plan, userId) => {
    const limits = PLAN_LIMITS[plan.slug];
    const reached = (Object.keys(limits) as UsageEventType[]).some((eventType) => {
      const limit = limits[eventType];
      return limit !== null && limit > 0 && (usageByUserAndEvent.get(`${userId}:${eventType}`) ?? 0) >= limit;
    });

    if (reached) {
      reachedUsers.add(userId);
    }
  });

  return reachedUsers;
}

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function getRecurringKeys(cases: CaseRow[]) {
  const cropCountByUser = new Map<string, number>();
  const farmCount = new Map<string, number>();

  cases.forEach((caseData) => {
    if (caseData.user_id && caseData.crop) {
      const key = `${caseData.user_id}:${normalizeText(caseData.crop)}`;
      cropCountByUser.set(key, (cropCountByUser.get(key) ?? 0) + 1);
    }

    if (caseData.farm_id) {
      farmCount.set(caseData.farm_id, (farmCount.get(caseData.farm_id) ?? 0) + 1);
    }
  });

  return { cropCountByUser, farmCount };
}

function hasRecurringCase(caseData: CaseRow, recurring: ReturnType<typeof getRecurringKeys>) {
  const recurringByCrop = Boolean(caseData.user_id && caseData.crop && (recurring.cropCountByUser.get(`${caseData.user_id}:${normalizeText(caseData.crop)}`) ?? 0) > 1);
  const recurringByFarm = Boolean(caseData.farm_id && (recurring.farmCount.get(caseData.farm_id) ?? 0) > 1);

  return recurringByCrop || recurringByFarm;
}

function getSuggestedOffer(caseData: CaseRow, reasons: string[]) {
  if (reasons.includes("caso recorrente da mesma cultura ou propriedade")) {
    return "Acompanhamento mensal R$ 997+";
  }

  if (caseData.risk_level === "high") {
    return "Relatório técnico R$ 500";
  }

  if (caseData.soil_analysis_url) {
    return "Interpretação de análise de solo R$ 250";
  }

  if (reasons.includes("sem revisão humana contratada")) {
    return "Revisão humana R$ 197";
  }

  return "Relatório técnico R$ 500";
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para acessar o painel de oportunidades." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const profile = await getAdminProfile(token, user.id);

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Acesso negado. Apenas administradores podem visualizar oportunidades comerciais." }, { status: 403 });
    }

    const adminConfig = getSupabaseAdminConfig();
    const cases = await supabaseAdminRequest<CaseRow[]>(
      "/rest/v1/agronomic_cases?select=id,user_id,crop,status,risk_level,human_review_requested,human_review_status,soil_analysis_url,created_at,farm_id&order=created_at.desc&limit=200",
      { method: "GET" },
      adminConfig
    );

    const userIds = Array.from(new Set(cases.map((caseData) => caseData.user_id).filter((userId): userId is string => Boolean(userId))));
    const farmIds = Array.from(new Set(cases.map((caseData) => caseData.farm_id).filter((farmId): farmId is string => Boolean(farmId))));
    const { periodStart, periodEnd } = getCurrentMonthlyPeriod();

    const [profiles, farms, subscriptions, usageEvents] = await Promise.all([
      userIds.length > 0
        ? supabaseAdminRequest<ProfileRow[]>(`/rest/v1/profiles?id=${buildInFilter(userIds)}&select=id,full_name`, { method: "GET" }, adminConfig)
        : Promise.resolve([]),
      farmIds.length > 0
        ? supabaseAdminRequest<FarmRow[]>(`/rest/v1/farms?id=${buildInFilter(farmIds)}&select=id,name`, { method: "GET" }, adminConfig)
        : Promise.resolve([]),
      userIds.length > 0
        ? supabaseAdminRequest<SubscriptionWithPlan[]>(
            `/rest/v1/subscriptions?user_id=${buildInFilter(userIds)}&select=user_id,status,current_period_end,created_at,plans(slug,name)&order=created_at.desc`,
            { method: "GET" },
            adminConfig
          )
        : Promise.resolve([]),
      userIds.length > 0
        ? supabaseAdminRequest<UsageEventRow[]>(
            `/rest/v1/usage_events?user_id=${buildInFilter(userIds)}&period_start=eq.${encodeURIComponent(periodStart)}&period_end=eq.${encodeURIComponent(periodEnd)}&select=user_id,event_type,count`,
            { method: "GET" },
            adminConfig
          )
        : Promise.resolve([])
    ]);

    const profileById = new Map(profiles.map((profileRow) => [profileRow.id, profileRow]));
    const farmById = new Map(farms.map((farm) => [farm.id, farm]));
    const planByUser = getPlanSummaries(userIds, subscriptions);
    const limitReachedUsers = getLimitReachedUsers(planByUser, usageEvents);
    const recurring = getRecurringKeys(cases);

    const opportunities = cases.reduce<CommercialOpportunity[]>((items, caseData) => {
      const userId = caseData.user_id;
      const userPlan = userId ? planByUser.get(userId) : null;
      const reasons: string[] = [];

      if (caseData.risk_level === "medium" || caseData.risk_level === "high") {
        reasons.push(`risco ${caseData.risk_level === "high" ? "alto" : "médio"}`);
      }

      if (!caseData.human_review_requested) {
        reasons.push("sem revisão humana contratada");
      }

      if (userPlan?.slug === "gratuito") {
        reasons.push("usuário no plano gratuito com caso enviado");
      }

      if (userId && limitReachedUsers.has(userId)) {
        reasons.push("usuário atingiu limite do plano");
      }

      if (hasRecurringCase(caseData, recurring)) {
        reasons.push("caso recorrente da mesma cultura ou propriedade");
      }

      if (reasons.length === 0) {
        return items;
      }

      items.push({
        id: `${caseData.id}:${reasons.join("|")}`,
        caseId: caseData.id,
        userId,
        userName: userId ? profileById.get(userId)?.full_name || "Usuário sem nome" : "Usuário não identificado",
        crop: caseData.crop || "Cultura não informada",
        risk: caseData.risk_level,
        currentPlan: userPlan?.label || PLAN_LABELS.gratuito,
        caseStatus: caseData.human_review_status || caseData.status || "Sem status",
        suggestedOffer: getSuggestedOffer(caseData, reasons),
        reasons,
        farmName: caseData.farm_id ? farmById.get(caseData.farm_id)?.name || "Propriedade sem nome" : "Propriedade não informada",
        createdAt: caseData.created_at
      });

      return items;
    }, []);

    return NextResponse.json({ opportunities, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar oportunidades comerciais.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

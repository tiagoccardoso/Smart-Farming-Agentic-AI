import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";

type ProfileStatus = "active" | "inactive";

type SpecialistProfile = {
  id: string;
  role: UserRole;
  status?: ProfileStatus | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
  phone: string | null;
  created_at: string | null;
  status: ProfileStatus | null;
  unlimited_access: boolean | null;
};

type AuthAdminUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
};

type AuthAdminUsersResponse = {
  users?: AuthAdminUser[];
};

type PlanRow = {
  slug: string | null;
  name: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  status: string | null;
  current_period_end: string | null;
  created_at: string | null;
  plans: PlanRow | null;
};

type CountRow = {
  user_id: string;
  count: number | null;
};

type FarmRow = {
  id: string;
  user_id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  area_hectares: number | null;
  soil_type: string | null;
  created_at: string | null;
};

type CaseRow = {
  id: string;
  user_id: string;
  crop: string | null;
  status: string | null;
  risk_level: string | null;
  human_review_requested: boolean | null;
  human_review_status: string | null;
  created_at: string | null;
};

type ReportRow = {
  id: string;
  user_id: string;
  case_id: string | null;
  report_type: string | null;
  report_url: string | null;
  created_at: string | null;
};

type PaymentRow = {
  id: string;
  user_id: string;
  case_id: string | null;
  service_type: string | null;
  price_cents: number | null;
  payment_status: string | null;
  created_at: string | null;
};

type UsageRow = {
  id: string;
  user_id: string;
  event_type: string | null;
  count: number | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string | null;
};

type UserMutationPayload = {
  userId?: string;
  status?: ProfileStatus;
  unlimited_access?: boolean;
  role?: UserRole;
};

const allowedRoles = new Set<UserRole>(["client", "specialist", "admin"]);
const allowedStatuses = new Set<ProfileStatus>(["active", "inactive"]);
const activeSubscriptionStatuses = new Set(["active", "trialing"]);

function getSupabaseAdminConfig() {
  const baseConfig = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Configure SUPABASE_SERVICE_ROLE_KEY para gerenciar usuários.");
  }

  return { supabaseUrl: baseConfig.supabaseUrl, serviceRoleKey };
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
    throw new Error(payload?.message || payload?.error_description || payload?.error || "Erro ao consultar Supabase.");
  }

  return payload as T;
}

function getToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}

async function getSpecialistProfile(token: string, userId: string) {
  const profiles = await supabaseRequest<SpecialistProfile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,status&limit=1`,
    { method: "GET" },
    token
  );

  return profiles[0] ?? null;
}

async function ensureSpecialist(token: string) {
  const user = await getAuthenticatedUser(token);
  const profile = await getSpecialistProfile(token, user.id);

  if (!profile || !["specialist", "admin"].includes(profile.role)) {
    return { error: NextResponse.json({ error: "Acesso negado. Apenas especialistas e administradores podem gerenciar usuários." }, { status: 403 }) };
  }

  if ((profile.status ?? "active") !== "active") {
    return { error: NextResponse.json({ error: "Seu usuário está inativo." }, { status: 403 }) };
  }

  return { user, profile };
}

function indexByUser<T extends { user_id: string }>(rows: T[]) {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    acc[row.user_id] = [...(acc[row.user_id] ?? []), row];
    return acc;
  }, {});
}

function countByUser(rows: CountRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.user_id] = Number(row.count ?? 0);
    return acc;
  }, {});
}

function getCurrentSubscription(subscriptions: SubscriptionRow[]) {
  const now = Date.now();

  return subscriptions.find((subscription) => {
    if (!subscription.status || !activeSubscriptionStatuses.has(subscription.status)) {
      return false;
    }

    if (!subscription.current_period_end) {
      return true;
    }

    return new Date(subscription.current_period_end).getTime() > now;
  }) ?? subscriptions[0] ?? null;
}

function sanitizeSearch(value: string | null) {
  return typeof value === "string" ? value.trim().replace(/[(),*]/g, " ").replace(/\s+/g, " ") : "";
}

function buildProfileQuery(searchParams: URLSearchParams) {
  const filters = ["select=id,full_name,role,phone,created_at,status,unlimited_access", "order=created_at.desc"];
  const role = searchParams.get("role");
  const status = searchParams.get("status");
  const name = sanitizeSearch(searchParams.get("name"));
  const email = sanitizeSearch(searchParams.get("email"));

  if (role && allowedRoles.has(role as UserRole)) {
    filters.push(`role=eq.${encodeURIComponent(role)}`);
  }

  if (status && allowedStatuses.has(status as ProfileStatus)) {
    filters.push(`status=eq.${encodeURIComponent(status)}`);
  }

  if (name) {
    filters.push(`full_name=ilike.*${encodeURIComponent(name)}*`);
  }

  // E-mail belongs to auth.users, so this API applies it after joining the Auth Admin result.
  return { path: `/rest/v1/profiles?${filters.join("&")}`, email };
}

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para gerenciar usuários." }, { status: 401 });
    }

    const auth = await ensureSpecialist(token);

    if (auth.error) {
      return auth.error;
    }

    const { searchParams } = new URL(request.url);
    const { path, email } = buildProfileQuery(searchParams);
    const plan = searchParams.get("plan")?.trim();
    const [profiles, authUsersResponse, subscriptions, farms, cases, reports, payments, usageEvents, caseCounts, reviewCounts] = await Promise.all([
      supabaseAdminRequest<ProfileRow[]>(path, { method: "GET" }),
      supabaseAdminRequest<AuthAdminUsersResponse>("/auth/v1/admin/users?page=1&per_page=1000", { method: "GET" }).catch(() => ({ users: [] })),
      supabaseAdminRequest<SubscriptionRow[]>("/rest/v1/subscriptions?select=id,user_id,status,current_period_end,created_at,plans(slug,name)&order=created_at.desc", { method: "GET" }),
      supabaseAdminRequest<FarmRow[]>("/rest/v1/farms?select=id,user_id,name,city,state,area_hectares,soil_type,created_at&order=created_at.desc", { method: "GET" }),
      supabaseAdminRequest<CaseRow[]>("/rest/v1/agronomic_cases?select=id,user_id,crop,status,risk_level,human_review_requested,human_review_status,created_at&order=created_at.desc&limit=1000", { method: "GET" }),
      supabaseAdminRequest<ReportRow[]>("/rest/v1/reports?select=id,user_id,case_id,report_type,report_url,created_at&order=created_at.desc&limit=1000", { method: "GET" }),
      supabaseAdminRequest<PaymentRow[]>("/rest/v1/one_time_orders?select=id,user_id,case_id,service_type,price_cents,payment_status,created_at&order=created_at.desc&limit=1000", { method: "GET" }),
      supabaseAdminRequest<UsageRow[]>("/rest/v1/usage_events?select=id,user_id,event_type,count,period_start,period_end,created_at&order=created_at.desc&limit=1000", { method: "GET" }),
      supabaseAdminRequest<CountRow[]>("/rest/v1/agronomic_cases?select=user_id,count", { method: "GET", headers: { Prefer: "count=exact" } }).catch(() => []),
      supabaseAdminRequest<CountRow[]>("/rest/v1/one_time_orders?service_type=ilike.*review*&payment_status=eq.paid&select=user_id,count", { method: "GET", headers: { Prefer: "count=exact" } }).catch(() => [])
    ]);

    const authUsersById = new Map((authUsersResponse.users ?? []).map((user) => [user.id, user]));
    const subscriptionsByUser = indexByUser(subscriptions);
    const farmsByUser = indexByUser(farms);
    const casesByUser = indexByUser(cases);
    const reportsByUser = indexByUser(reports);
    const paymentsByUser = indexByUser(payments);
    const usageByUser = indexByUser(usageEvents);
    const casesCountByUser = countByUser(caseCounts);
    const reviewsCountByUser = countByUser(reviewCounts);
    const normalizedEmail = email.toLowerCase();

    const users = profiles
      .map((profile) => {
        const authUser = authUsersById.get(profile.id);
        const userSubscriptions = subscriptionsByUser[profile.id] ?? [];
        const currentSubscription = getCurrentSubscription(userSubscriptions);
        const planName = currentSubscription?.plans?.name ?? (currentSubscription ? "Plano sem nome" : null);
        const planSlug = currentSubscription?.plans?.slug ?? null;
        const userCases = casesByUser[profile.id] ?? [];
        const paidReviews = paymentsByUser[profile.id]?.filter((payment) => payment.payment_status === "paid" && (payment.service_type ?? "").toLowerCase().includes("review")) ?? [];

        return {
          ...profile,
          email: authUser?.email ?? null,
          phone: profile.phone ?? authUser?.phone ?? null,
          created_at: profile.created_at ?? authUser?.created_at ?? null,
          last_sign_in_at: authUser?.last_sign_in_at ?? null,
          current_plan: planName ? { name: planName, slug: planSlug, subscription_status: currentSubscription?.status ?? null } : null,
          cases_count: casesCountByUser[profile.id] ?? userCases.length,
          human_reviews_count: reviewsCountByUser[profile.id] ?? paidReviews.length,
          details: {
            farms: farmsByUser[profile.id] ?? [],
            cases: userCases.slice(0, 25),
            reports: (reportsByUser[profile.id] ?? []).slice(0, 25),
            subscriptions: userSubscriptions.slice(0, 10),
            payments: (paymentsByUser[profile.id] ?? []).slice(0, 25),
            usage_events: (usageByUser[profile.id] ?? []).slice(0, 50)
          }
        };
      })
      .filter((user) => !normalizedEmail || (user.email ?? "").toLowerCase().includes(normalizedEmail))
      .filter((user) => !plan || user.current_plan?.slug === plan || user.current_plan?.name === plan || (!user.current_plan && plan === "sem-plano"));

    return NextResponse.json({ users, role: auth.profile.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível listar usuários.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para alterar usuários." }, { status: 401 });
    }

    const auth = await ensureSpecialist(token);

    if (auth.error) {
      return auth.error;
    }

    const payload = (await request.json().catch(() => null)) as UserMutationPayload | null;

    if (!payload) {
      return NextResponse.json({ error: "Informe os dados da alteração." }, { status: 400 });
    }

    const targetUserId = payload.userId?.trim();

    if (!targetUserId) {
      return NextResponse.json({ error: "Informe o usuário que será alterado." }, { status: 400 });
    }

    const targetRows = await supabaseAdminRequest<ProfileRow[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(targetUserId)}&select=id,full_name,role,phone,created_at,status,unlimited_access&limit=1`,
      { method: "GET" }
    );
    const target = targetRows[0];

    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    if (auth.profile.role !== "admin" && target.role === "admin") {
      return NextResponse.json({ error: "Especialistas não podem alterar administradores." }, { status: 403 });
    }

    const updates: Partial<Pick<ProfileRow, "status" | "unlimited_access" | "role">> = {};

    if (payload.status !== undefined) {
      if (!allowedStatuses.has(payload.status)) {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      }
      updates.status = payload.status;
    }

    if (payload.unlimited_access !== undefined) {
      updates.unlimited_access = Boolean(payload.unlimited_access);
    }

    if (payload.role !== undefined) {
      if (auth.profile.role !== "admin") {
        return NextResponse.json({ error: "Apenas administradores podem alterar papéis." }, { status: 403 });
      }
      if (!allowedRoles.has(payload.role)) {
        return NextResponse.json({ error: "Role inválida." }, { status: 400 });
      }
      updates.role = payload.role;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nenhuma alteração informada." }, { status: 400 });
    }

    if (target.id === auth.user.id) {
      const nextRole = updates.role ?? target.role;
      const nextStatus = updates.status ?? target.status ?? "active";

      if (nextStatus !== "active" || !["specialist", "admin"].includes(nextRole)) {
        return NextResponse.json({ error: "Você não pode remover seu próprio acesso administrativo." }, { status: 403 });
      }
    }

    const updatedRows = await supabaseAdminRequest<ProfileRow[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(targetUserId)}&select=id,full_name,role,phone,created_at,status,unlimited_access`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(updates)
      }
    );

    return NextResponse.json({ user: updatedRows[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível alterar o usuário.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

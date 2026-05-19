export type UserRole = "client" | "specialist" | "admin";

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  role: UserRole;
  phone: string | null;
  city?: string | null;
  state?: string | null;
  status?: "active" | "inactive" | null;
  unlimited_access?: boolean | null;
  created_at?: string | null;
};

type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

export const AUTH_ACCESS_COOKIE = "sf_access_token";
export const AUTH_REFRESH_COOKIE = "sf_refresh_token";

export function getSupabaseAuthConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para usar autenticação.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

export function extractBearerToken(authorizationHeader: string | null) {
  return authorizationHeader?.replace(/^Bearer\s+/i, "") || null;
}

export async function supabaseAuthRequest<T>(path: string, init: RequestInit = {}, token?: string | null, config = getSupabaseAuthConfig()) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || "Erro ao comunicar com o Supabase Auth.");
  }

  return payload as T;
}

export async function getCurrentUser(token: string, config = getSupabaseAuthConfig()) {
  return supabaseAuthRequest<AuthenticatedUser>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config
  );
}

export async function getCurrentProfile(token: string, userId?: string, config = getSupabaseAuthConfig()) {
  const user = userId ? { id: userId } : await getCurrentUser(token, config);
  const profiles = await supabaseAuthRequest<Profile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,phone,city,state,status,unlimited_access,created_at&limit=1`,
    { method: "GET" },
    token,
    config
  );

  return profiles[0] ?? null;
}

export function isActiveProfile(profile: Pick<Profile, "status"> | null | undefined) {
  return (profile?.status ?? "active") === "active";
}

export function hasRole(profile: Pick<Profile, "role" | "status"> | null | undefined, allowedRoles: UserRole[]) {
  return Boolean(profile?.role && allowedRoles.includes(profile.role) && isActiveProfile(profile));
}

export async function ensureClientProfile(token: string, userId: string, fullName: string, phone?: string | null, config = getSupabaseAuthConfig()) {
  const rows = await supabaseAuthRequest<Profile[]>(
    "/rest/v1/profiles?on_conflict=id&select=id,full_name,role,phone,city,state,status,unlimited_access,created_at",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: userId, full_name: fullName, phone: phone || null, role: "client" })
    },
    token,
    config
  );

  return rows[0] ?? null;
}

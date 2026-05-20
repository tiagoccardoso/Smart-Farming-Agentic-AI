import type { AuthenticatedUser, Profile } from "./auth";

export type AuthSessionPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: AuthenticatedUser;
  profile?: Profile | null;
  needsEmailConfirmation?: boolean;
  message?: string;
};

async function parseAuthResponse(response: Response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        "A autenticação não pôde ser concluída.",
    );
  }

  return payload as AuthSessionPayload;
}

export function getStoredSupabaseAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const appToken = window.localStorage.getItem("smart-farming-access-token");

  if (appToken) {
    return appToken;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const projectRef = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const preferredKeys = [
    projectRef ? `sb-${projectRef}-auth-token` : null,
    "supabase.auth.token",
  ].filter(Boolean) as string[];

  const keys = [
    ...preferredKeys,
    ...Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string =>
      Boolean(key?.startsWith("sb-") && key.endsWith("-auth-token")),
    ),
  ];

  for (const key of keys) {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawValue);
      const token =
        parsed?.access_token ??
        parsed?.currentSession?.access_token ??
        parsed?.session?.access_token;

      if (typeof token === "string" && token.length > 0) {
        return token;
      }
    } catch {
      if (rawValue.startsWith("ey")) {
        return rawValue;
      }
    }
  }

  return null;
}

export function storeSupabaseSession(payload: AuthSessionPayload) {
  if (typeof window === "undefined" || !payload.access_token) {
    return;
  }

  window.localStorage.setItem(
    "smart-farming-access-token",
    payload.access_token,
  );

  if (payload.refresh_token) {
    window.localStorage.setItem(
      "smart-farming-refresh-token",
      payload.refresh_token,
    );
  }
}

export function clearStoredSupabaseSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem("smart-farming-access-token");
  window.localStorage.removeItem("smart-farming-refresh-token");
}

export async function loginWithEmailPassword(email: string, password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseAuthResponse(response);
  storeSupabaseSession(payload);
  return payload;
}

export async function requestPasswordRecovery(email: string) {
  const response = await fetch("/api/auth/recover-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error || "Não foi possível enviar a recuperação de senha.",
    );
  }

  return payload as { message?: string };
}

export async function registerWithEmailPassword(data: {
  fullName: string;
  email: string;
  password: string;
  phone: string;
}) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const payload = await parseAuthResponse(response);
  storeSupabaseSession(payload);
  return payload;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  clearStoredSupabaseSession();
}

export async function getCurrentAuthSession() {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (response.status === 401) {
    return null;
  }

  const payload = await parseAuthResponse(response);
  storeSupabaseSession(payload);
  return payload;
}

export async function updateCurrentProfile(data: {
  fullName: string;
  phone: string;
}) {
  const response = await fetch("/api/auth/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  return parseAuthResponse(response);
}

export async function updateCurrentAuthCredentials(data: {
  email?: string;
  password?: string;
}) {
  const response = await fetch("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  return parseAuthResponse(response);
}

export function getStoredSupabaseAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const projectRef = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const preferredKeys = [
    projectRef ? `sb-${projectRef}-auth-token` : null,
    "supabase.auth.token"
  ].filter(Boolean) as string[];

  const keys = [
    ...preferredKeys,
    ...Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(
      (key): key is string => Boolean(key?.startsWith("sb-") && key.endsWith("-auth-token"))
    )
  ];

  for (const key of keys) {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawValue);
      const token = parsed?.access_token ?? parsed?.currentSession?.access_token ?? parsed?.session?.access_token;

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

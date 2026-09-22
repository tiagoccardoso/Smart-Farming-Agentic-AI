/**
 * Acesso administrativo ao Supabase (service role).
 *
 * Centraliza a configuração para que rotas de billing, webhooks e pareceres
 * usem exatamente o mesmo cliente. A service role key NUNCA e exposta ao
 * frontend: este módulo só pode ser importado por código de servidor.
 */

export type SupabaseAdminConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export function getSupabaseAdminConfig(): SupabaseAdminConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para processar cobrancas.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey };
}

export async function supabaseAdminRequest<T>(path: string, init: RequestInit, config = getSupabaseAdminConfig()) {
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

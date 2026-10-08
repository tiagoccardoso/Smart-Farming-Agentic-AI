/**
 * Cliente REST mínimo do Supabase (PostgREST, Auth e Storage) usado pelas rotas
 * de casos agronômicos.
 *
 * - `supabaseRequest` usa a anon key + token do usuário (RLS do próprio usuário).
 * - `supabaseServiceRequest` usa a service role quando configurada. Só deve ser
 *   chamado DEPOIS de o servidor confirmar a propriedade do caso com o token do
 *   usuário; serve para gravar campos de conteúdo que a RLS restringe por status.
 *
 * O erro lançado preserva status HTTP e código do PostgREST para que as rotas
 * consigam devolver mensagens precisas (permissão, sessão expirada, conflito).
 */

export type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

export class SupabaseRestError extends Error {
  status: number;
  code: string | null;
  details: string | null;

  constructor(message: string, status: number, code: string | null = null, details: string | null = null) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para consultar casos.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

function parseJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 300) } as Record<string, unknown>;
  }
}

async function performRequest<T>(url: string, init: RequestInit, apiKey: string, bearer: string) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });

  const payload = parseJson(await response.text());

  if (!response.ok) {
    const message =
      (payload?.message as string | undefined) ||
      (payload?.error_description as string | undefined) ||
      (payload?.error as string | undefined) ||
      "Erro ao comunicar com o Supabase.";
    throw new SupabaseRestError(
      String(message),
      response.status,
      typeof payload?.code === "string" ? payload.code : null,
      typeof payload?.details === "string" ? payload.details : null,
    );
  }

  return payload as T;
}

export async function supabaseRequest<T>(path: string, init: RequestInit, token: string, config = getSupabaseConfig()) {
  return performRequest<T>(`${config.supabaseUrl}${path}`, init, config.anonKey, token);
}

export function hasServiceRoleKey() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Requisição com a service role quando disponível; sem ela, usa o token do
 * usuário (e a RLS decide). Use somente após validar a propriedade do recurso.
 */
export async function supabaseServiceRequest<T>(path: string, init: RequestInit, fallbackToken: string) {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return performRequest<T>(`${config.supabaseUrl}${path}`, init, config.anonKey, fallbackToken);
  }

  return performRequest<T>(`${config.supabaseUrl}${path}`, init, serviceRoleKey, serviceRoleKey);
}

export async function getAuthenticatedUser(token: string, config = getSupabaseConfig()) {
  return supabaseRequest<{ id: string; email?: string | null }>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config,
  );
}

/**
 * Registro durável das análises iniciais em andamento
 * (tabela public.agronomic_analysis_jobs, migration 20261010120000).
 *
 * Escritas somente com a service role, depois de a rota validar sessão e
 * propriedade do caso. Sem a migration aplicada, o store lança
 * AnalysisJobStoreUnavailableError e a rota volta ao fluxo síncrono.
 */

export type AnalysisJobStatus = "processing" | "saving" | "completed" | "failed";

export type AnalysisJob = {
  id: string;
  case_id: string;
  user_id: string;
  status: AnalysisJobStatus;
  provider: string | null;
  model: string | null;
  provider_response_id: string | null;
  request_id: string | null;
  error_code: string | null;
  image_summary: unknown;
  context: unknown;
  save_attempts: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewAnalysisJob = Pick<AnalysisJob, "case_id" | "user_id" | "request_id">;
export type AnalysisJobPatch = Partial<Omit<AnalysisJob, "id" | "case_id" | "user_id" | "created_at">>;

export type AnalysisJobStoreUnavailableReason = "missing_config" | "table_missing";

export class AnalysisJobStoreUnavailableError extends Error {
  readonly reason: AnalysisJobStoreUnavailableReason;
  /** Código do PostgREST/Postgres que indicou a ausência (ex.: PGRST205). */
  readonly dbCode: string | null;
  constructor(
    message = "Tabela agronomic_analysis_jobs indisponível (migration 20261010120000 não aplicada?).",
    reason: AnalysisJobStoreUnavailableReason = "table_missing",
    dbCode: string | null = null,
  ) {
    super(message);
    this.name = "AnalysisJobStoreUnavailableError";
    this.reason = reason;
    this.dbCode = dbCode;
  }
}

export interface AnalysisJobStore {
  /** Job mais recente do caso (qualquer status). */
  latestForCase(caseId: string): Promise<AnalysisJob | null>;
  /** Cria um job "processing"; "conflict" quando já existe um ativo para o caso. */
  insert(input: NewAnalysisJob): Promise<AnalysisJob | "conflict">;
  /**
   * Atualiza o job somente se o status atual estiver em `from` (troca atômica
   * no banco). Devolve a linha atualizada ou null se outro processo chegou antes.
   */
  transition(id: string, from: AnalysisJobStatus[], patch: AnalysisJobPatch): Promise<AnalysisJob | null>;
}

type StoreConfig = { supabaseUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch };

const TABLE = "/rest/v1/agronomic_analysis_jobs";
const COLUMNS =
  "id,case_id,user_id,status,provider,model,provider_response_id,request_id,error_code,image_summary,context,save_attempts,started_at,completed_at,created_at,updated_at";

export function createSupabaseAnalysisJobStore(config?: Partial<StoreConfig>): AnalysisJobStore {
  const supabaseUrl = (config?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceRoleKey = config?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const fetchImpl = config?.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit): Promise<{ status: number; data: T | null; code?: string }> {
    if (!supabaseUrl || !serviceRoleKey) throw new AnalysisJobStoreUnavailableError("Service role do Supabase não configurada.", "missing_config");
    const response = await fetchImpl(`${supabaseUrl}${path}`, {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const code = typeof data?.code === "string" ? data.code : undefined;
    if (!response.ok) {
      // Tabela inexistente: PostgREST responde PGRST205 (404) ou 42P01.
      if (code === "PGRST205" || code === "42P01" || (response.status === 404 && /agronomic_analysis_jobs/.test(text))) {
        throw new AnalysisJobStoreUnavailableError(undefined, "table_missing", code ?? `http_${response.status}`);
      }
      return { status: response.status, data: null, code };
    }
    return { status: response.status, data: data as T, code };
  }

  return {
    async latestForCase(caseId) {
      const result = await request<AnalysisJob[]>(
        `${TABLE}?case_id=eq.${encodeURIComponent(caseId)}&select=${COLUMNS}&order=created_at.desc&limit=1`,
        { method: "GET" },
      );
      if (!result.data) throw new Error(`Falha ao consultar análises em andamento (${result.status}).`);
      return result.data[0] ?? null;
    },
    async insert(input) {
      const result = await request<AnalysisJob[]>(`${TABLE}?select=${COLUMNS}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...input, status: "processing" }),
      });
      if (result.code === "23505" || result.status === 409) return "conflict";
      if (!result.data?.[0]) throw new Error(`Falha ao registrar a análise (${result.status}).`);
      return result.data[0];
    },
    async transition(id, from, patch) {
      const result = await request<AnalysisJob[]>(
        `${TABLE}?id=eq.${encodeURIComponent(id)}&status=in.(${from.join(",")})&select=${COLUMNS}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        },
      );
      if (result.code === "23505" || result.status === 409) return null;
      if (!result.data) throw new Error(`Falha ao atualizar a análise (${result.status}).`);
      return result.data[0] ?? null;
    },
  };
}

/**
 * "Existem informações novas depois da última análise da IA?"
 *
 * Fontes de atualização de contexto:
 * - case_activity_logs com metadata.kind = case_updated | attachment_added
 *   (e o registro legado "Usuário editou", sem kind).
 *
 * Mensagens do chat não contam: cada resposta do chat já atualiza a análise.
 * Análises novas carregam `analyzedAt`; análises antigas não. Para estas, só
 * consideramos registros novos (com `kind`), que por definição são posteriores.
 */

export type FreshnessActivityLog = {
  id?: string;
  action: string;
  metadata?: Record<string, unknown> | null;
  created_at: string | null;
};

export type CaseFreshness = {
  analysisAt: string | null;
  latestContextUpdateAt: string | null;
  updatesSinceAnalysis: number;
  hasUpdatesSinceAnalysis: boolean;
};

export const CONTEXT_UPDATE_KINDS = ["case_updated", "attachment_added"] as const;

function kindOf(log: FreshnessActivityLog) {
  const kind = log.metadata && typeof log.metadata.kind === "string" ? log.metadata.kind : null;
  return kind;
}

export function isContextUpdateLog(log: FreshnessActivityLog) {
  const kind = kindOf(log);
  if (kind) return (CONTEXT_UPDATE_KINDS as readonly string[]).includes(kind);
  return log.action === "Usuário editou";
}

function toTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function computeCaseFreshness(input: {
  hasAnalysis: boolean;
  analyzedAt?: string | null;
  activityLogs: FreshnessActivityLog[];
}): CaseFreshness {
  const logs = input.activityLogs ?? [];
  const analysisLogTimes = logs
    .filter((log) => kindOf(log) === "ai_analysis")
    .map((log) => toTime(log.created_at))
    .filter((time): time is number => time !== null);
  const explicitAnalysisTime = toTime(input.analyzedAt ?? null);
  const analysisTime = explicitAnalysisTime ?? (analysisLogTimes.length ? Math.max(...analysisLogTimes) : null);

  const updates = logs.filter(isContextUpdateLog);
  const updateTimes = updates.map((log) => toTime(log.created_at)).filter((time): time is number => time !== null);
  const latest = updateTimes.length ? Math.max(...updateTimes) : null;

  let updatesSinceAnalysis = 0;
  if (input.hasAnalysis) {
    if (analysisTime !== null) {
      updatesSinceAnalysis = updateTimes.filter((time) => time > analysisTime).length;
    } else {
      // Análise legada sem data: apenas atualizações registradas no formato novo.
      updatesSinceAnalysis = updates.filter((log) => kindOf(log) !== null).length;
    }
  }

  return {
    analysisAt: analysisTime !== null ? new Date(analysisTime).toISOString() : null,
    latestContextUpdateAt: latest !== null ? new Date(latest).toISOString() : null,
    updatesSinceAnalysis,
    hasUpdatesSinceAnalysis: updatesSinceAnalysis > 0,
  };
}

export type AnalysisHistoryEntry = {
  id: string;
  createdAt: string | null;
  source: string | null;
  previous: {
    analyzedAt: string | null;
    initialDiagnosis: string | null;
    riskLevel: string | null;
    confidenceLevel: string | null;
    summary: string | null;
  } | null;
};

function shortText(value: unknown, max = 1200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? (trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed) : null;
}

/**
 * Separa o histórico de análises (com a versão anterior resumida) e devolve os
 * registros de atividade sem o JSON completo da análise anterior, que é grande.
 */
export function splitActivityLogs<T extends FreshnessActivityLog & { id: string }>(logs: T[]) {
  const analysisHistory: AnalysisHistoryEntry[] = [];
  const activityLogs = logs.map((log) => {
    if (kindOf(log) !== "ai_analysis") return log;
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    const previous = metadata.previous as Record<string, unknown> | undefined;
    analysisHistory.push({
      id: log.id,
      createdAt: log.created_at,
      source: typeof metadata.source === "string" ? metadata.source : null,
      previous: previous
        ? {
            analyzedAt: typeof previous.analyzedAt === "string" ? previous.analyzedAt : null,
            initialDiagnosis: shortText(previous.initialDiagnosis, 600),
            riskLevel: typeof previous.riskLevel === "string" ? previous.riskLevel : null,
            confidenceLevel: typeof previous.confidenceLevel === "string" ? previous.confidenceLevel : null,
            summary: shortText(previous.popularSummary ?? previous.initialDiagnosis),
          }
        : null,
    });
    const { previous: _previous, ...rest } = metadata;
    return { ...log, metadata: rest };
  });
  return { activityLogs, analysisHistory: analysisHistory.reverse() };
}

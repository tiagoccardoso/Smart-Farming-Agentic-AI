/**
 * Linha do tempo cronológica do caso para o Painel da Doutora (lógica pura).
 */

import { buildChatTimeline, type ChatMessageRow, type ChatTurnItem } from "./case-chat";

export type SpecialistTimelinePayload = {
  case: { created_at: string | null; symptoms: string };
  requestedAt: string | null;
  messages: ChatMessageRow[];
  activityLogs: Array<{ id: string; action: string; metadata?: Record<string, unknown> | null; created_at: string | null }>;
  analysisHistory: Array<{ id: string; createdAt: string | null; source: string | null }>;
  reviews: Array<{ id: string; status: string | null; reviewed_at: string | null; created_at: string | null; bySpecialist: boolean }>;
};

export type TimelineEntry =
  | { kind: "created"; id: string; at: string | null; title: string }
  | { kind: "update"; id: string; at: string | null; title: string; detail: string | null }
  | { kind: "chat"; id: string; at: string | null; item: ChatTurnItem }
  | { kind: "analysis"; id: string; at: string | null; title: string }
  | { kind: "request"; id: string; at: string | null; title: string }
  | { kind: "review"; id: string; at: string | null; title: string };

export type DecoratedEntry = TimelineEntry & { isNew: boolean; afterRequest: boolean };

const FIELD_LABELS: Record<string, string> = {
  crop: "cultura",
  growth_stage: "estágio",
  symptoms: "sintomas",
  history: "histórico",
  "farm.name": "propriedade",
  "farm.city": "cidade",
  "farm.state": "estado",
  "farm.area_hectares": "área",
  "farm.soil_type": "tipo de solo",
};

function time(value: string | null) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function describeUpdate(log: SpecialistTimelinePayload["activityLogs"][number]) {
  const metadata = log.metadata ?? {};
  const kind = typeof metadata.kind === "string" ? metadata.kind : null;
  if (kind === "attachment_added") {
    return { title: metadata.attachment === "soil_analysis" ? "Produtor anexou análise de solo" : "Produtor anexou nova foto", detail: null };
  }
  if (kind === "case_updated" || log.action === "Usuário editou") {
    const fields = Array.isArray(metadata.fields) ? (metadata.fields as string[]).map((field) => FIELD_LABELS[field] ?? field) : [];
    const removed = typeof metadata.removedImages === "number" && metadata.removedImages > 0 ? `${metadata.removedImages} foto(s) removida(s)` : null;
    return { title: "Produtor atualizou o caso", detail: [fields.length ? `Campos: ${fields.join(", ")}` : null, removed].filter(Boolean).join(" · ") || null };
  }
  return null;
}

export function buildSpecialistTimeline(payload: SpecialistTimelinePayload): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ kind: "created", id: "created", at: payload.case.created_at, title: "Caso criado pelo produtor" }];

  for (const log of payload.activityLogs) {
    const update = describeUpdate(log);
    if (update) entries.push({ kind: "update", id: `log-${log.id}`, at: log.created_at, ...update });
  }
  for (const entry of payload.analysisHistory) {
    entries.push({ kind: "analysis", id: `analysis-${entry.id}`, at: entry.createdAt, title: entry.source === "chat" ? "Análise da IA refinada pela conversa" : "Nova análise da IA" });
  }
  if (payload.requestedAt) entries.push({ kind: "request", id: "request", at: payload.requestedAt, title: "Parecer humano solicitado" });
  for (const review of payload.reviews.filter((item) => item.bySpecialist)) {
    entries.push({
      kind: "review",
      id: `review-${review.id}`,
      at: review.status === "completed" ? review.reviewed_at ?? review.created_at : review.created_at,
      title: review.status === "completed" ? "Parecer finalizado" : "Parecer iniciado (rascunho)",
    });
  }
  for (const item of buildChatTimeline(payload.messages)) {
    entries.push({ kind: "chat", id: `chat-${item.id}`, at: item.createdAt, item });
  }

  return entries.sort((a, b) => time(a.at) - time(b.at));
}

/**
 * Marca o que é novo desde a última visita da especialista e o que chegou
 * depois da solicitação do parecer. Itens da própria especialista não contam.
 */
export function decorateTimeline(entries: TimelineEntry[], options: { lastSeenAt: string | null; requestedAt: string | null }): DecoratedEntry[] {
  const lastSeen = options.lastSeenAt ? time(options.lastSeenAt) : null;
  const requested = options.requestedAt ? time(options.requestedAt) : null;
  return entries.map((entry) => {
    const at = time(entry.at);
    const fromProducerOrAi = entry.kind !== "review" && entry.kind !== "created";
    return {
      ...entry,
      isNew: Boolean(lastSeen !== null && fromProducerOrAi && at > lastSeen),
      afterRequest: Boolean(requested !== null && entry.kind !== "request" && entry.kind !== "review" && at > requested),
    };
  });
}

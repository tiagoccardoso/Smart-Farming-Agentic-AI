/**
 * Regras puras do fluxo de pareceres do Painel da Doutora (fila, rascunhos e
 * finalização). Sem dependências de rede para poderem ser testadas isoladamente
 * e reutilizadas pela API e pela interface.
 *
 * Modelo de dados (existente):
 * - agronomic_cases.human_review_status: waiting_review (pendente) → in_review
 *   (rascunho salvo) → reviewed/completed (parecer finalizado).
 * - human_reviews: um registro por parecer. A solicitação do produtor cria um
 *   registro "pending" sem especialista; o rascunho da especialista é um
 *   registro "in_review" com specialist_id; a finalização o torna "completed".
 */

export type HumanReviewRow = {
  id: string;
  case_id: string;
  specialist_id: string | null;
  status: string;
  review_text: string | null;
  technical_recommendation: string | null;
  final_observations: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

export type ReviewQueueBucket = "pending" | "draft" | "completed";

export const ACTIVE_REVIEW_CASE_STATUSES = ["waiting_review", "in_review"] as const;
export const COMPLETED_REVIEW_CASE_STATUSES = ["reviewed", "completed"] as const;

/** Quantidade de pareceres concluídos recentes exibidos no painel. */
export const COMPLETED_REVIEWS_LIMIT = 30;

export type ReviewFormValues = {
  reviewText: string;
  technicalRecommendation: string;
  finalObservations: string;
};

export const EMPTY_REVIEW_FORM: ReviewFormValues = {
  reviewText: "",
  technicalRecommendation: "",
  finalObservations: "",
};

export function getReviewBucket(humanReviewStatus?: string | null): ReviewQueueBucket | null {
  if (humanReviewStatus === "waiting_review") return "pending";
  if (humanReviewStatus === "in_review") return "draft";
  if (humanReviewStatus === "reviewed" || humanReviewStatus === "completed") return "completed";
  return null;
}

function byNewest(a: HumanReviewRow, b: HumanReviewRow) {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

function isSpecialistDraft(row: HumanReviewRow) {
  return row.status === "in_review" && Boolean(row.specialist_id);
}

/**
 * Parecer que representa o estado atual do caso no painel: o finalizado mais
 * recente para casos concluídos e o rascunho mais recente para os demais.
 */
export function pickCurrentReview(rows: HumanReviewRow[], humanReviewStatus?: string | null): HumanReviewRow | null {
  const sorted = [...rows].sort(byNewest);

  if (getReviewBucket(humanReviewStatus) === "completed") {
    return sorted.find((row) => row.status === "completed") ?? null;
  }

  return sorted.find(isSpecialistDraft) ?? null;
}

export type DraftTarget =
  | { kind: "insert" }
  | { kind: "update"; row: HumanReviewRow }
  | { kind: "conflict"; row: HumanReviewRow };

/**
 * Decide onde gravar o parecer para nunca duplicar rascunhos:
 * - rascunho da própria especialista → atualiza o mesmo registro;
 * - rascunho de outra especialista → administradores assumem o registro,
 *   especialistas recebem conflito (não sobrescrevem trabalho alheio);
 * - nenhum rascunho → cria um novo registro.
 */
export function resolveDraftTarget(rows: HumanReviewRow[], userId: string, isAdmin: boolean): DraftTarget {
  const drafts = rows.filter(isSpecialistDraft).sort(byNewest);
  const own = drafts.find((row) => row.specialist_id === userId);

  if (own) return { kind: "update", row: own };

  const other = drafts[0];

  if (!other) return { kind: "insert" };

  return isAdmin ? { kind: "update", row: other } : { kind: "conflict", row: other };
}

export function reviewRowToForm(row?: Pick<HumanReviewRow, "review_text" | "technical_recommendation" | "final_observations"> | null): ReviewFormValues {
  return {
    reviewText: row?.review_text ?? "",
    technicalRecommendation: row?.technical_recommendation ?? "",
    finalObservations: row?.final_observations ?? "",
  };
}

export function isSameReviewForm(a: ReviewFormValues, b: ReviewFormValues) {
  return (
    a.reviewText.trim() === b.reviewText.trim() &&
    a.technicalRecommendation.trim() === b.technicalRecommendation.trim() &&
    a.finalObservations.trim() === b.finalObservations.trim()
  );
}

export function isReviewFormEmpty(form: ReviewFormValues) {
  return isSameReviewForm(form, EMPTY_REVIEW_FORM);
}

/** Campos obrigatórios para finalizar (mesma regra já aplicada pela API). */
export function getMissingFinalizeFields(form: ReviewFormValues) {
  const missing: Array<keyof ReviewFormValues> = [];
  if (!form.reviewText.trim()) missing.push("reviewText");
  if (!form.technicalRecommendation.trim()) missing.push("technicalRecommendation");
  return missing;
}

// ---------------------------------------------------------------------------
// Busca e ordenação da fila
// ---------------------------------------------------------------------------

export type QueueSort = "oldest" | "newest" | "updated" | "risk";

export type QueueSearchable = {
  crop?: string | null;
  symptoms?: string | null;
  growth_stage?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  risk_level?: string | null;
  farm?: { name?: string | null; city?: string | null; state?: string | null } | null;
};

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesQueueSearch(item: QueueSearchable, term: string) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return true;

  const haystack = normalizeSearchText(
    [item.crop, item.symptoms, item.growth_stage, item.farm?.name, item.farm?.city, item.farm?.state]
      .filter(Boolean)
      .join(" "),
  );

  return normalizedTerm.split(/\s+/).every((word) => haystack.includes(word));
}

const riskWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function sortQueue<T extends QueueSearchable>(items: T[], sort: QueueSort): T[] {
  const time = (value?: string | null) => (value ? new Date(value).getTime() || 0 : 0);

  return [...items].sort((a, b) => {
    switch (sort) {
      case "newest":
        return time(b.created_at) - time(a.created_at);
      case "updated":
        return time(b.updated_at ?? b.created_at) - time(a.updated_at ?? a.created_at);
      case "risk":
        return (
          (riskWeight[b.risk_level ?? ""] ?? 0) - (riskWeight[a.risk_level ?? ""] ?? 0) ||
          time(a.created_at) - time(b.created_at)
        );
      case "oldest":
      default:
        return time(a.created_at) - time(b.created_at);
    }
  });
}

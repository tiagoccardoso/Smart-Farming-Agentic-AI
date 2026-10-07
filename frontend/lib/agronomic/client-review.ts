/**
 * Regras puras da visão do PRODUTOR sobre a Revisão Humana (tela
 * /revisao-humana e Meus Relatórios): etapa atual, parecer do agrônomo que pode
 * ser exibido, linha do tempo e indicador de "parecer novo".
 *
 * Usa apenas dados já existentes:
 * - agronomic_cases.human_review_status / status / human_review_requested;
 * - human_reviews (review_text, technical_recommendation, final_observations,
 *   status, specialist_id, reviewed_at, created_at);
 * - case_activity_logs ("Parecer agronômico humano solicitado").
 *
 * Sem dependências de rede: testado em tests/client-review.test.ts.
 */

export type ClientReviewStage =
  | "not_requested"
  | "pending_payment"
  | "waiting_review"
  | "in_review"
  | "completed"
  | "cancelled"
  | "rejected";

export type ReviewStageInfo = {
  /** Rótulo curto do badge. */
  label: string;
  /** Frase principal exibida no painel de status. */
  title: string;
  /** O que acontece agora / o que o produtor pode fazer. */
  description: string;
  /** Chave de cor do StatusBadge existente. */
  tone: string;
};

export const REVIEW_STAGE_INFO: Record<ClientReviewStage, ReviewStageInfo> = {
  not_requested: {
    label: "Revisão não solicitada",
    title: "Este caso ainda não foi enviado para revisão humana",
    description: "A orientação disponível é apenas a análise inicial automatizada. Solicite o parecer agronômico para validação por um profissional.",
    tone: "ai_analyzed",
  },
  pending_payment: {
    label: "Pagamento pendente",
    title: "Solicitação antiga aguardando pagamento",
    description: "Este pedido foi criado no modelo de cobrança avulsa, que não existe mais. Solicite o parecer pelo benefício do seu plano ou cancele a solicitação.",
    tone: "pending_payment",
  },
  waiting_review: {
    label: "Aguardando revisão",
    title: "Caso na fila do agrônomo",
    description: "Seu caso foi recebido e aguarda o início da análise pelo profissional responsável. Você será informado aqui quando o parecer estiver pronto.",
    tone: "waiting_review",
  },
  in_review: {
    label: "Em análise",
    title: "O agrônomo está analisando seu caso",
    description: "O parecer está sendo elaborado. Ele aparecerá nesta tela assim que for concluído.",
    tone: "in_review",
  },
  completed: {
    label: "Parecer concluído",
    title: "Parecer do agrônomo disponível",
    description: "A revisão foi concluída. Leia abaixo as conclusões e recomendações do profissional.",
    tone: "completed",
  },
  cancelled: {
    label: "Cancelada",
    title: "Solicitação de revisão cancelada",
    description: "Esta solicitação foi cancelada. A análise inicial continua disponível e o caso pode ser enviado novamente.",
    tone: "cancelled",
  },
  rejected: {
    label: "Não realizada",
    title: "A revisão não pôde ser realizada",
    description: "O profissional não conseguiu concluir a revisão deste caso. O parecer do seu plano não é consumido nessa situação; você pode complementar as informações e enviar novamente.",
    tone: "rejected",
  },
};

const WAITING_STATUSES = ["waiting_review", "waiting_human_review", "waiting_soil_review", "waiting_technical_report"];
const COMPLETED_STATUSES = ["reviewed", "completed", "human_reviewed"];

/**
 * Etapa atual do ponto de vista do produtor. "Rascunho" da especialista é
 * apresentado como "Em análise": o conteúdo do rascunho nunca é exibido.
 */
export function getClientReviewStage(caseData: {
  human_review_status?: string | null;
  human_review_requested?: boolean | null;
  status?: string | null;
}): ClientReviewStage {
  const reviewStatus = caseData.human_review_status ?? "";

  if (COMPLETED_STATUSES.includes(reviewStatus) || caseData.status === "human_reviewed") return "completed";
  if (reviewStatus === "in_review") return "in_review";
  // "pending" é do fluxo avulso antigo (antes do pagamento): não está na fila da especialista.
  if (["pending_payment", "pending"].includes(reviewStatus) || caseData.status === "waiting_payment_human_review") return "pending_payment";
  if (reviewStatus === "rejected") return "rejected";
  if (reviewStatus === "cancelled") return "cancelled";
  if (WAITING_STATUSES.includes(reviewStatus) || caseData.status === "waiting_human_review") {
    return caseData.human_review_requested === false ? "not_requested" : "waiting_review";
  }
  return "not_requested";
}

export function isReviewInProgress(stage: ClientReviewStage) {
  return stage === "waiting_review" || stage === "in_review";
}

// ---------------------------------------------------------------------------
// Parecer exibido ao produtor
// ---------------------------------------------------------------------------

export type StoredHumanReview = {
  id: string;
  case_id: string;
  specialist_id?: string | null;
  status: string | null;
  review_text: string | null;
  technical_recommendation: string | null;
  final_observations: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

function newestFirst(a: StoredHumanReview, b: StoredHumanReview) {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/**
 * Registro que representa o parecer do caso: o finalizado mais recente quando
 * o caso está concluído; caso contrário, o registro mais recente (apenas para
 * metadados de andamento).
 */
export function pickClientReviewRow<T extends StoredHumanReview>(rows: T[], humanReviewStatus?: string | null): T | null {
  const sorted = [...rows].sort(newestFirst);
  if (COMPLETED_STATUSES.includes(humanReviewStatus ?? "")) {
    return sorted.find((row) => row.status === "completed") ?? sorted[0] ?? null;
  }
  return sorted[0] ?? null;
}

/** Remove o texto de qualquer parecer que não esteja finalizado (rascunhos). */
export function redactUnfinishedReview<T extends StoredHumanReview>(row: T): T {
  if (row.status === "completed") return row;
  return { ...row, review_text: null, technical_recommendation: null, final_observations: null };
}

export type ClientHumanReview = {
  id: string | null;
  /** Status do registro em human_reviews (pending, in_review, completed, rejected). */
  status: string | null;
  reviewText: string | null;
  technicalRecommendation: string | null;
  finalObservations: string | null;
  reviewedAt: string | null;
  requestedAt: string | null;
  analysisStartedAt: string | null;
  specialistName: string | null;
};

export const REVIEW_REQUESTED_LOG_ACTION = "Parecer agronômico humano solicitado";

/**
 * Monta o resumo seguro do parecer para o produtor. O texto só é devolvido
 * quando há parecer finalizado; o id da especialista nunca sai daqui.
 */
export function buildClientHumanReview(input: {
  rows: StoredHumanReview[];
  humanReviewStatus?: string | null;
  activityLogs?: Array<{ action: string; created_at: string | null }>;
  specialistName?: string | null;
}): ClientHumanReview | null {
  const { rows, humanReviewStatus, activityLogs = [] } = input;
  const current = pickClientReviewRow(rows, humanReviewStatus);
  const requestLogs = activityLogs.filter((log) => log.action === REVIEW_REQUESTED_LOG_ACTION && log.created_at);
  const requestedFromLog = requestLogs.length ? requestLogs[requestLogs.length - 1].created_at : null;
  const requestRow = [...rows].sort(newestFirst).find((row) => !row.specialist_id);
  const specialistRows = rows
    .filter((row) => row.specialist_id && row.created_at)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  if (!current && !requestedFromLog) return null;

  const completed = current?.status === "completed" && COMPLETED_STATUSES.includes(humanReviewStatus ?? "");

  return {
    id: current?.id ?? null,
    status: current?.status ?? null,
    reviewText: completed ? current?.review_text ?? null : null,
    technicalRecommendation: completed ? current?.technical_recommendation ?? null : null,
    finalObservations: completed ? current?.final_observations ?? null : null,
    reviewedAt: completed ? current?.reviewed_at ?? null : null,
    requestedAt: requestedFromLog ?? requestRow?.created_at ?? null,
    analysisStartedAt: specialistRows[0]?.created_at ?? null,
    specialistName: completed ? input.specialistName?.trim() || null : null,
  };
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------

export type TimelineStepState = "done" | "current" | "upcoming" | "stopped";

export type TimelineStep = {
  key: "created" | "ai" | "requested" | "in_review" | "completed";
  label: string;
  state: TimelineStepState;
  date: string | null;
};

export function buildReviewTimeline(input: {
  stage: ClientReviewStage;
  caseCreatedAt: string | null;
  hasAiAnalysis: boolean;
  review: Pick<ClientHumanReview, "requestedAt" | "analysisStartedAt" | "reviewedAt"> | null;
}): TimelineStep[] {
  const { stage, review } = input;
  const requested = stage !== "not_requested";
  const started = stage === "in_review" || stage === "completed";
  const finished = stage === "completed";
  const stopped = stage === "cancelled" || stage === "rejected";

  const steps: TimelineStep[] = [
    { key: "created", label: "Caso enviado", state: "done", date: input.caseCreatedAt },
    { key: "ai", label: "Análise inicial automatizada", state: input.hasAiAnalysis ? "done" : "upcoming", date: null },
    {
      key: "requested",
      label: stage === "pending_payment" ? "Solicitação aguardando pagamento" : "Enviado para revisão humana",
      state: stage === "pending_payment" ? "current" : requested ? "done" : "upcoming",
      date: review?.requestedAt ?? null,
    },
    {
      key: "in_review",
      label: "Em análise pelo agrônomo",
      state: finished ? "done" : started ? "current" : "upcoming",
      date: review?.analysisStartedAt ?? null,
    },
    {
      key: "completed",
      label: stage === "cancelled" ? "Solicitação cancelada" : stage === "rejected" ? "Revisão não realizada" : "Parecer concluído",
      state: finished ? "done" : stopped ? "stopped" : "upcoming",
      date: finished ? review?.reviewedAt ?? null : null,
    },
  ];

  if (stage === "waiting_review") {
    steps[3] = { ...steps[3], state: "current", label: "Aguardando início da análise" };
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Leitura de textos longos
// ---------------------------------------------------------------------------

export type TextBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

const LIST_ITEM = /^\s*(?:[-•*–]|\d+[.)])\s+/;

/** Divide o texto livre do parecer em parágrafos e listas para leitura escaneável. */
export function toTextBlocks(value?: string | null): TextBlock[] {
  const clean = value?.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const line of clean.split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (LIST_ITEM.test(line)) {
      flushParagraph();
      list.push(line.replace(LIST_ITEM, "").trim());
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

// ---------------------------------------------------------------------------
// Indicador de parecer novo (registro local, por navegador)
// ---------------------------------------------------------------------------

export type SeenOpinions = Record<string, string>;

/** Um parecer é "novo" até ser aberto; uma nova finalização volta a sinalizá-lo. */
export function isOpinionUnseen(caseId: string, reviewedAt: string | null | undefined, seen: SeenOpinions) {
  if (!reviewedAt) return !(caseId in seen);
  return seen[caseId] !== reviewedAt;
}

export function markOpinionSeen(seen: SeenOpinions, caseId: string, reviewedAt: string | null | undefined): SeenOpinions {
  return { ...seen, [caseId]: reviewedAt ?? "seen" };
}

export function parseSeenOpinions(raw: string | null): SeenOpinions {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

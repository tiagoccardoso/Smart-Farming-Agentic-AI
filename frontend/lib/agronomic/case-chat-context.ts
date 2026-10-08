/**
 * Montagem do contexto do chat conversacional de um caso (lógica pura).
 *
 * O chat é separado da análise inicial:
 * - a análise inicial (ai_analysis_json) entra apenas como REFERÊNCIA no
 *   contexto e nunca é regravada pelo chat;
 * - cada pergunta gera uma nova inferência com o histórico em papéis reais
 *   (system / user / assistant) e a pergunta atual como última mensagem.
 *
 * Limite de contexto: mensagens recentes entram completas; as antigas viram um
 * resumo compacto (determinístico, sem chamada extra de IA) para não exceder
 * os limites de tokens.
 */

import type { AIImageInput, AIMessage } from "../../src/lib/ai/providers/types";
import { AUDIO_MESSAGE_LABEL, IMAGE_MESSAGE_LABEL, trailingUserMessages, type ChatMessageRow } from "./case-chat";

export type ChatContextHypothesis = {
  name?: string | null;
  probability?: string | null;
  justification?: string | null;
};

export type ChatContextAnalysis = {
  initialDiagnosis?: string | null;
  popularSummary?: string | null;
  detailedHypotheses?: ChatContextHypothesis[] | null;
  probableHypotheses?: string[] | null;
  riskLevel?: string | null;
  confidenceLevel?: string | null;
  safeInitialRecommendations?: string[] | null;
  attentionPoints?: string[] | null;
  nextSteps?: string[] | null;
  analyzedAt?: string | null;
};

export type ChatContextCase = {
  id: string;
  user_id?: string | null;
  crop: string;
  growth_stage?: string | null;
  symptoms: string;
  history?: string | null;
  soil_analysis_url?: string | null;
  risk_level?: string | null;
  ai_summary?: string | null;
  ai_analysis_json?: ChatContextAnalysis | null;
  created_at?: string | null;
  updated_at?: string | null;
  farm?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    area_hectares?: number | null;
    soil_type?: string | null;
  } | null;
  images: Array<{ id?: string; image_url: string; image_type?: string | null; created_at?: string | null }>;
  crop_context?: {
    name?: string | null;
    display_name_pt?: string | null;
    scientific_name?: string | null;
    common_diseases?: string | null;
    common_pests?: string | null;
    ideal_climate?: string | null;
  } | null;
};

export type ChatContextHumanReview = {
  reviewText?: string | null;
  technicalRecommendation?: string | null;
  finalObservations?: string | null;
  reviewedAt?: string | null;
} | null;

export type ChatContextPendingQuestion = {
  id: string;
  question: string;
  answer: string | null;
  status: "pending" | "answered" | "skipped";
  order_index: number;
};

export type ChatContextUpdate = { at: string | null; description: string };

export type ChatImageCandidate = { url: string; label: string; source: "chat" | "case" };

export type LoadedChatImage = ChatImageCandidate & { input: AIImageInput };
export type UnavailableChatImage = ChatImageCandidate & { reason: string };

export const CASE_CHAT_SYSTEM_PROMPT = `Você é a IA do PlantaSa, assistente especializado em saúde vegetal: doenças de plantas, pragas, nutrição, manejo agronômico, plantas ornamentais, medicinais e culturas agrícolas. Você conversa em português do Brasil com o produtor sobre UM caso específico, cujos dados estão abaixo.

Como responder:
- Responda diretamente à PERGUNTA ATUAL (a última mensagem do usuário). Ela é a prioridade; não responda a uma pergunta anterior no lugar dela.
- Use o histórico da conversa para manter continuidade. Quando o usuário se referir a algo dito antes ("a segunda hipótese", "isso", "o que você falou"), localize a referência no histórico e responda sobre ela.
- A análise inicial do caso é apenas referência. Não a repita nem a resuma de novo, a menos que o usuário peça. Traga só o trecho que ajuda a responder.
- Diferencie claramente: sintomas relatados pelo produtor, hipóteses (possibilidades) e diagnósticos confirmados. Sem exame de laboratório ou visita técnica, nada está confirmado.
- Ajuste o tamanho da resposta à pergunta: dúvida simples, resposta curta (2 a 5 frases); pergunta complexa, resposta organizada com tópicos curtos. Evite textos longos sem necessidade.
- Use linguagem acessível ao produtor; explique termos técnicos quando usá-los.
- Se faltar informação para responder bem, diga o que falta e peça no máximo 1 ou 2 informações objetivas.
- Informe limitações e incertezas com honestidade.
- Recomende avaliação por engenheiro agrônomo quando houver risco relevante, decisão de aplicação de produto ou incerteza importante, sem encerrar a conversa por isso.

Limites obrigatórios:
- Nunca invente resultados de laboratório, análises, dados do caso, fontes, referências ou conversas que não estão no contexto.
- Nunca indique dose, concentração de calda, taxa por hectare ou quantidade por planta de defensivos, nem prescreva produto controlado.
- Só descreva o conteúdo visual de uma foto se ela foi realmente anexada à mensagem para você ver. Se uma foto aparece apenas listada (sem a imagem), diga que não conseguiu visualizá-la.
- Se existir parecer técnico humano no contexto, ele é de um agrônomo do PlantaSa: atribua a ele, nunca o apresente como conclusão sua, e não contradiga o parecer sem deixar claro que se trata de uma hipótese sua.
- Não emita laudo nem diagnóstico definitivo.

Formato: Markdown simples (parágrafos curtos, listas com "-" ou "1.", **negrito** pontual). Não use tabelas, não use títulos com "#" em respostas curtas e não escreva URLs.`;

const MAX_FIELD = 1200;

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function truncateText(value: string | null | undefined, max: number) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

const LEVEL_PT: Record<string, string> = { low: "baixo", medium: "médio", high: "alto" };

function level(value: string | null | undefined) {
  return value ? LEVEL_PT[value] ?? value : "não informado";
}

function list(items: Array<string | null | undefined> | null | undefined, max: number, itemMax = 220) {
  return (items ?? []).map((item) => truncateText(item, itemMax)).filter(Boolean).slice(0, max);
}

/** Bloco com o resumo da análise inicial (referência, não resposta). */
export function summarizeInitialAnalysis(caseData: ChatContextCase) {
  const analysis = caseData.ai_analysis_json;
  if (!analysis && !caseData.ai_summary) {
    return "A análise inicial da IA ainda não foi gerada para este caso.";
  }
  const lines: string[] = [];
  const when = formatDate(analysis?.analyzedAt ?? null);
  lines.push(`Análise inicial da IA${when ? ` (gerada em ${when})` : ""}. É REFERÊNCIA: não repita, use só o necessário.`);
  const overview = truncateText(analysis?.initialDiagnosis || caseData.ai_summary, 700);
  if (overview) lines.push(`Visão geral: ${overview}`);
  lines.push(`Risco: ${level(analysis?.riskLevel ?? caseData.risk_level)}. Confiança: ${level(analysis?.confidenceLevel)}.`);
  const hypotheses = (analysis?.detailedHypotheses ?? []).filter((item) => clean(item?.name));
  if (hypotheses.length) {
    lines.push("Hipóteses levantadas na análise inicial (na ordem apresentada ao produtor):");
    hypotheses.slice(0, 5).forEach((item, index) => {
      const justification = truncateText(item.justification, 220);
      lines.push(`${index + 1}. ${truncateText(item.name, 140)} (probabilidade ${level(item.probability)})${justification ? `: ${justification}` : ""}`);
    });
  } else {
    const simple = list(analysis?.probableHypotheses, 5);
    if (simple.length) {
      lines.push("Hipóteses levantadas na análise inicial:");
      simple.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
  }
  const recommendations = list(analysis?.safeInitialRecommendations?.length ? analysis.safeInitialRecommendations : analysis?.nextSteps, 4, 180);
  if (recommendations.length) lines.push(`Recomendações iniciais já dadas: ${recommendations.join(" | ")}`);
  return lines.join("\n");
}

export function summarizeHumanReview(review: ChatContextHumanReview) {
  if (!review || !(clean(review.reviewText) || clean(review.technicalRecommendation) || clean(review.finalObservations))) return null;
  const when = formatDate(review.reviewedAt);
  return [
    `Parecer técnico HUMANO (emitido por agrônomo do PlantaSa${when ? ` em ${when}` : ""}; não é da IA):`,
    clean(review.reviewText) ? `Avaliação: ${truncateText(review.reviewText, MAX_FIELD)}` : null,
    clean(review.technicalRecommendation) ? `Recomendação técnica: ${truncateText(review.technicalRecommendation, 800)}` : null,
    clean(review.finalObservations) ? `Observações finais: ${truncateText(review.finalObservations, 500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Bloco de contexto do caso (dados atuais, lidos do banco a cada pergunta). */
export function buildCaseContextBlock(input: {
  caseData: ChatContextCase;
  humanReview?: ChatContextHumanReview;
  pendingQuestions?: ChatContextPendingQuestion[];
  updates?: ChatContextUpdate[];
  olderConversationSummary?: string | null;
  leadingAssistantMessages?: string[];
}) {
  const { caseData } = input;
  const farm = caseData.farm;
  const location = [farm?.city, farm?.state].map(clean).filter(Boolean).join("/");
  const crop = caseData.crop_context;
  const cropName = clean(crop?.display_name_pt || crop?.name) || clean(caseData.crop) || "não informada";

  const sections: string[] = [];
  sections.push(
    [
      "DADOS DO CASO (informados pelo produtor; são relatos, não diagnósticos):",
      `- Cultura/espécie: ${cropName}${crop?.scientific_name ? ` (${clean(crop.scientific_name)})` : ""}`,
      `- Estágio: ${clean(caseData.growth_stage) || "não informado"}`,
      `- Sintomas relatados: ${truncateText(caseData.symptoms, MAX_FIELD) || "não informados"}`,
      `- Histórico/manejo relatado: ${truncateText(caseData.history, MAX_FIELD) || "não informado"}`,
      `- Local: ${location || "não informado"}${farm?.name ? ` (propriedade ${clean(farm.name)})` : ""}`,
      farm?.area_hectares ? `- Área: ${farm.area_hectares} ha` : null,
      `- Solo: ${clean(farm?.soil_type) || "não informado"}; análise de solo ${caseData.soil_analysis_url ? "anexada (conteúdo do arquivo não está disponível para você)" : "não anexada"}`,
      `- Fotos no caso: ${caseData.images.length}`,
      crop?.common_diseases ? `- Doenças comuns cadastradas para a cultura: ${truncateText(crop.common_diseases, 300)}` : null,
      crop?.common_pests ? `- Pragas comuns cadastradas para a cultura: ${truncateText(crop.common_pests, 300)}` : null,
      crop?.ideal_climate ? `- Clima ideal da cultura: ${truncateText(crop.ideal_climate, 200)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (input.updates?.length) {
    sections.push(
      [
        "ATUALIZAÇÕES DO CASO (mais recentes primeiro; os dados acima já estão atualizados):",
        ...input.updates.slice(0, 6).map((update) => `- ${formatDate(update.at) ?? "sem data"}: ${truncateText(update.description, 200)}`),
      ].join("\n"),
    );
  }

  sections.push(summarizeInitialAnalysis(caseData));

  const review = summarizeHumanReview(input.humanReview ?? null);
  if (review) sections.push(review);

  const answered = (input.pendingQuestions ?? []).filter((question) => question.status === "answered" && clean(question.answer));
  if (answered.length) {
    sections.push(
      [
        "Informações complementares já respondidas pelo produtor:",
        ...answered.slice(-8).map((question) => `- ${truncateText(question.question, 160)} → ${truncateText(question.answer, 240)}`),
      ].join("\n"),
    );
  }

  if (input.leadingAssistantMessages?.length) {
    sections.push(["Mensagens iniciais da IA registradas no chat:", ...input.leadingAssistantMessages.map((text) => `- ${truncateText(text, 300)}`)].join("\n"));
  }

  if (input.olderConversationSummary) sections.push(input.olderConversationSummary);

  return sections.join("\n\n");
}

/** Texto de uma linha do banco como conteúdo de mensagem do modelo. */
function rowAsText(row: ChatMessageRow, next: ChatMessageRow | undefined) {
  if (row.message_type === "image") {
    const caption = row.message && row.message !== IMAGE_MESSAGE_LABEL && !/^Nova imagem enviada/i.test(row.message) ? ` Legenda: ${row.message}` : "";
    return `[Foto enviada no chat.${caption}]`;
  }
  if (row.message_type === "audio") {
    if (next?.message_type === "transcription") return null;
    const legacy = row.message && row.message !== AUDIO_MESSAGE_LABEL && !/^Transcrição automática indisponível/i.test(row.message) ? row.message : null;
    return legacy ? `[Áudio enviado. Transcrição: ${legacy}]` : "[Áudio enviado, sem transcrição disponível.]";
  }
  if (row.message_type === "transcription") return `[Áudio enviado. Transcrição automática: ${row.message}]`;
  return row.message;
}

type Turn = { role: "user" | "assistant"; content: string };

/** Agrupa linhas consecutivas do mesmo papel em turnos alternados. */
export function rowsToTurns(rows: ChatMessageRow[]): Turn[] {
  const turns: Turn[] = [];
  rows.forEach((row, index) => {
    const text = rowAsText(row, rows[index + 1]);
    if (!text || !text.trim()) return;
    const previous = turns[turns.length - 1];
    if (previous && previous.role === row.role) {
      previous.content = `${previous.content}\n${text.trim()}`;
    } else {
      turns.push({ role: row.role, content: text.trim() });
    }
  });
  return turns;
}

function summarizeOlderTurns(turns: Turn[], maxChars: number) {
  if (!turns.length) return null;
  const lines: string[] = [];
  let used = 0;
  // Do mais recente para o mais antigo, para preservar o que está mais perto.
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const line = `- ${turn.role === "user" ? "Produtor" : "IA"}: ${truncateText(turn.content, turn.role === "user" ? 260 : 200)}`;
    if (used + line.length > maxChars) {
      lines.unshift(`- (${index + 1} mensagem(ns) ainda mais antiga(s) omitida(s))`);
      break;
    }
    lines.unshift(line);
    used += line.length;
  }
  return ["RESUMO COMPACTO DA PARTE ANTIGA DA CONVERSA (trechos; as mensagens recentes seguem completas):", ...lines].join("\n");
}

export type CaseChatPromptOptions = {
  /** Orçamento (caracteres) para o histórico recente completo. */
  historyBudgetChars?: number;
  /** Orçamento (caracteres) para o resumo das mensagens antigas. */
  olderSummaryBudgetChars?: number;
  /** Máximo de turnos recentes completos. */
  maxRecentTurns?: number;
};

export type CaseChatPrompt = {
  messages: AIMessage[];
  currentQuestion: string;
  stats: { recentTurns: number; summarizedTurns: number; totalChars: number };
};

/**
 * Monta as mensagens enviadas ao modelo:
 * [system: regras + contexto do caso] + histórico (user/assistant alternados)
 * + [user: pergunta atual, com as imagens anexadas de fato].
 */
export function buildCaseChatPrompt(input: {
  caseData: ChatContextCase;
  rows: ChatMessageRow[];
  humanReview?: ChatContextHumanReview;
  pendingQuestions?: ChatContextPendingQuestion[];
  updates?: ChatContextUpdate[];
  images?: { loaded: LoadedChatImage[]; unavailable: UnavailableChatImage[] };
  likelyAnsweredPendingQuestion?: string | null;
  options?: CaseChatPromptOptions;
}): CaseChatPrompt {
  const historyBudget = input.options?.historyBudgetChars ?? 14000;
  const olderBudget = input.options?.olderSummaryBudgetChars ?? 2500;
  const maxRecentTurns = input.options?.maxRecentTurns ?? 16;

  const pendingRows = trailingUserMessages(input.rows);
  if (!pendingRows.length) throw new Error("Não há mensagem do usuário aguardando resposta.");
  const historyRows = input.rows.slice(0, input.rows.length - pendingRows.length);

  let turns = rowsToTurns(historyRows);
  // Mensagens iniciais da IA (antes de qualquer fala do produtor) vão para o
  // contexto: a conversa enviada ao modelo sempre começa por "user".
  const leadingAssistant: string[] = [];
  while (turns.length && turns[0].role === "assistant") {
    leadingAssistant.push(turns.shift()!.content);
  }

  const recent: Turn[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (recent.length >= maxRecentTurns || used + turn.content.length > historyBudget) break;
    recent.unshift(turn);
    used += turn.content.length;
  }
  // O histórico recente precisa começar com "user".
  while (recent.length && recent[0].role === "assistant") {
    recent.shift();
  }
  const older = turns.slice(0, turns.length - recent.length);

  const contextBlock = buildCaseContextBlock({
    caseData: input.caseData,
    humanReview: input.humanReview,
    pendingQuestions: input.pendingQuestions,
    updates: input.updates,
    olderConversationSummary: summarizeOlderTurns(older, olderBudget),
    leadingAssistantMessages: leadingAssistant.slice(-2),
  });

  const currentTurn = rowsToTurns(pendingRows).map((turn) => turn.content).join("\n");
  const currentQuestion = currentTurn.trim();

  const nextPending = (input.pendingQuestions ?? [])
    .filter((question) => question.status === "pending")
    .sort((a, b) => a.order_index - b.order_index)[0];

  const notes: string[] = [];
  const loaded = input.images?.loaded ?? [];
  const unavailable = input.images?.unavailable ?? [];
  if (loaded.length) {
    notes.push(`Imagens anexadas a esta mensagem para você ver (${loaded.length}): ${loaded.map((image, index) => `imagem ${index + 1} = ${image.label}`).join("; ")}.`);
  }
  if (unavailable.length) {
    notes.push(`Fotos que NÃO puderam ser carregadas para você (não descreva o conteúdo delas): ${unavailable.map((image) => `${image.label} (${image.reason})`).join("; ")}.`);
  }
  if (input.likelyAnsweredPendingQuestion) {
    notes.push(`Esta mensagem parece responder à pergunta pendente: "${truncateText(input.likelyAnsweredPendingQuestion, 200)}". Considere a resposta e comente o que ela muda.`);
  }
  if (nextPending && nextPending.question !== input.likelyAnsweredPendingQuestion) {
    notes.push(`Pergunta de triagem ainda pendente (opcional): "${truncateText(nextPending.question, 200)}". Só a faça ao final, em uma frase, se for útil e não atrapalhar a resposta.`);
  }

  const finalUserContent = [
    "PERGUNTA ATUAL DO PRODUTOR (responda a esta):",
    currentQuestion || "(mensagem sem texto)",
    notes.length ? `\n[Notas do sistema]\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: AIMessage[] = [
    { role: "system", content: `${CASE_CHAT_SYSTEM_PROMPT}\n\n=== CONTEXTO DO CASO ===\n${contextBlock}` },
    ...recent.map((turn) => ({ role: turn.role, content: turn.content }) as AIMessage),
    { role: "user", content: finalUserContent, ...(loaded.length ? { images: loaded.map((image) => image.input) } : {}) },
  ];

  return {
    messages,
    currentQuestion,
    stats: {
      recentTurns: recent.length,
      summarizedTurns: older.length,
      totalChars: messages.reduce((sum, message) => sum + message.content.length, 0),
    },
  };
}

/** Fotos a anexar: as enviadas agora primeiro, depois as mais recentes do caso. */
export function selectChatImages(input: {
  pendingRows: ChatMessageRow[];
  caseImages: ChatContextCase["images"];
  max?: number;
}): ChatImageCandidate[] {
  const max = input.max ?? 3;
  const selected: ChatImageCandidate[] = [];
  const seen = new Set<string>();
  const chatImages = input.pendingRows.filter((row) => row.message_type === "image" && row.file_url);
  chatImages.forEach((row, index) => {
    if (selected.length >= max || seen.has(row.file_url!)) return;
    seen.add(row.file_url!);
    selected.push({ url: row.file_url!, source: "chat", label: chatImages.length > 1 ? `foto ${index + 1} enviada agora no chat` : "foto enviada agora no chat" });
  });
  const caseImages = [...input.caseImages]
    .filter((image) => image.image_url && !seen.has(image.image_url))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  for (const image of caseImages) {
    if (selected.length >= max) break;
    seen.add(image.image_url);
    const when = formatDate(image.created_at ?? null);
    selected.push({ url: image.image_url, source: "case", label: `foto do caso${when ? ` de ${when}` : ""}` });
  }
  return selected;
}

const QUESTION_START = /^(o que|oque|que|qual|quais|quanto|quantos|quantas|quando|onde|como|por que|porque|pq|será|sera|pode|posso|devo|deveria|é possível|e possivel|existe|há|ha|tem como|você|voce|explique|explica|me explique|me diga|diga|fale|compare|mostre|ajude|preciso saber|gostaria de saber|quero saber)\b/i;

/**
 * Heurística para a fila de perguntas pendentes: uma mensagem que é ela mesma
 * uma pergunta/pedido NÃO deve ser gravada como resposta da pergunta pendente.
 */
export function isLikelyQuestion(text: string) {
  const value = clean(text).toLowerCase();
  if (!value) return false;
  if (value.includes("?")) return true;
  return QUESTION_START.test(value);
}

/**
 * Decide se o turno atual responde à pergunta pendente da fila (texto ou
 * transcrição que não é, ele mesmo, uma pergunta).
 */
export function pendingAnswerFromTurn(pendingRows: ChatMessageRow[]) {
  const text = pendingRows
    .filter((row) => row.message_type === "text" || row.message_type === "transcription")
    .map((row) => row.message.trim())
    .filter(Boolean)
    .join("\n");
  if (!text || isLikelyQuestion(text)) return null;
  return text;
}

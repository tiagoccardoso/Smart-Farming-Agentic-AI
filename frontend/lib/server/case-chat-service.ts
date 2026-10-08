/**
 * Serviço do chat conversacional do caso (independente de Next.js e do
 * Supabase: o acesso a dados vem por `CaseChatStore`, o que permite testar o
 * fluxo completo com um banco em memória).
 *
 * Fluxo de um envio:
 * 1. `recordUserTurn` grava a mensagem do produtor (idempotente por
 *    clientMessageId) ANTES de chamar a IA.
 * 2. `runAssistantTurn` lê o caso ATUAL do banco, monta o contexto (caso,
 *    análise inicial como referência, parecer humano, histórico) e faz uma
 *    nova inferência para a pergunta atual.
 * 3. A resposta é gravada vinculada à última mensagem do turno
 *    (reply_to_message_id). Se outra requisição já respondeu o mesmo turno, a
 *    resposta duplicada não é gravada.
 *
 * O chat NUNCA altera ai_analysis_json nem pareceres humanos.
 */

import { trailingUserMessages, type ChatMessageRow } from "../agronomic/case-chat";
import {
  buildCaseChatPrompt,
  pendingAnswerFromTurn,
  selectChatImages,
  type ChatContextCase,
  type ChatContextHumanReview,
  type ChatContextPendingQuestion,
  type ChatContextUpdate,
  type ChatImageCandidate,
  type LoadedChatImage,
  type UnavailableChatImage,
} from "../agronomic/case-chat-context";
import { generateCaseChatReply, type CaseChatLogger, type ChatProviders } from "../agronomic/case-chat-ai";

export type StoredChatMessage = ChatMessageRow & {
  case_id: string;
  user_id: string;
  client_message_id?: string | null;
  reply_to_message_id?: string | null;
};

export type NewChatMessage = {
  caseId: string;
  userId: string;
  role: "user" | "assistant";
  message: string;
  messageType?: ChatMessageRow["message_type"];
  fileUrl?: string | null;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
};

export interface CaseChatStore {
  loadCase(caseId: string): Promise<(ChatContextCase & { user_id?: string | null; human_review_status?: string | null }) | null>;
  listMessages(caseId: string): Promise<StoredChatMessage[]>;
  /** Mensagem de texto do usuário já gravada com este clientMessageId (ou null). */
  findUserTextByClientId(caseId: string, clientMessageId: string): Promise<StoredChatMessage | null>;
  /** Grava a mensagem. Retorna null quando o banco recusa por duplicidade. */
  insertMessage(input: NewChatMessage): Promise<StoredChatMessage | null>;
  listPendingQuestions(caseId: string): Promise<ChatContextPendingQuestion[]>;
  answerPendingQuestion(questionId: string, answer: string): Promise<void>;
  loadHumanReview(caseData: { id: string; human_review_status?: string | null }): Promise<ChatContextHumanReview>;
  listCaseUpdates(caseId: string): Promise<ChatContextUpdate[]>;
}

export class CaseChatAccessError extends Error {
  status = 404;
  code = "NOT_FOUND";
  constructor() {
    super("Caso não encontrado ou sem permissão.");
  }
}

/** Só o dono do caso conversa com a IA sobre ele (verificação no servidor). */
export function assertCaseChatAccess<T extends { user_id?: string | null }>(caseData: T | null, userId: string): T {
  if (!caseData || !caseData.user_id || caseData.user_id !== userId) throw new CaseChatAccessError();
  return caseData;
}

export async function recordUserTurn(
  store: CaseChatStore,
  input: {
    caseId: string;
    userId: string;
    text: string;
    clientMessageId: string | null;
    imageUrls: string[];
    audio?: { url: string; transcription: string | null } | null;
    imageLabel: string;
    audioLabel: string;
  },
) {
  const existing = await store.listMessages(input.caseId);
  const alreadyRecorded = (url: string) => existing.some((message) => message.file_url === url);
  const inserted: StoredChatMessage[] = [];
  let duplicateText = false;

  if (input.text) {
    // Reenvio (queda de rede, duplo clique): mesmo clientMessageId não duplica.
    const byClientId = input.clientMessageId ? await store.findUserTextByClientId(input.caseId, input.clientMessageId) : null;
    // Compatibilidade sem a coluna nova: mesmo texto ainda sem resposta.
    const unansweredTexts = trailingUserMessages(existing).filter((row) => row.message_type === "text").map((row) => row.message);
    duplicateText = Boolean(byClientId) || unansweredTexts.includes(input.text);
    if (!duplicateText) {
      const row = await store.insertMessage({ caseId: input.caseId, userId: input.userId, role: "user", message: input.text, clientMessageId: input.clientMessageId });
      if (row) inserted.push(row);
      else duplicateText = true;
    }
  }
  for (const url of input.imageUrls) {
    if (alreadyRecorded(url)) continue;
    const row = await store.insertMessage({ caseId: input.caseId, userId: input.userId, role: "user", message: input.imageLabel, messageType: "image", fileUrl: url, clientMessageId: input.clientMessageId });
    if (row) inserted.push(row);
  }
  if (input.audio && !alreadyRecorded(input.audio.url)) {
    const row = await store.insertMessage({ caseId: input.caseId, userId: input.userId, role: "user", message: input.audioLabel, messageType: "audio", fileUrl: input.audio.url, clientMessageId: input.clientMessageId });
    if (row) inserted.push(row);
    if (input.audio.transcription) {
      const transcription = await store.insertMessage({ caseId: input.caseId, userId: input.userId, role: "user", message: input.audio.transcription, messageType: "transcription", clientMessageId: input.clientMessageId });
      if (transcription) inserted.push(transcription);
    }
  }
  return { inserted, duplicateText };
}

export type AssistantTurnResult =
  | { status: "nothing_pending"; message: null }
  | { status: "already_answered"; message: StoredChatMessage | null }
  | {
      status: "answered";
      message: StoredChatMessage;
      provider: string;
      model: string;
      fallbackUsed: boolean;
      answeredPendingQuestionId: string | null;
    };

export type ImageLoader = (candidates: ChatImageCandidate[]) => Promise<{ loaded: LoadedChatImage[]; unavailable: UnavailableChatImage[] }>;

export async function runAssistantTurn(
  store: CaseChatStore,
  input: {
    caseId: string;
    userId: string;
    requestId: string;
    providers: ChatProviders;
    loadImages?: ImageLoader;
    deadlineAt?: number;
    logger?: CaseChatLogger;
    maxImages?: number;
  },
): Promise<AssistantTurnResult> {
  const caseData = assertCaseChatAccess(await store.loadCase(input.caseId), input.userId);
  const [rows, pendingQuestions, humanReview, updates] = await Promise.all([
    store.listMessages(input.caseId),
    store.listPendingQuestions(input.caseId).catch(() => [] as ChatContextPendingQuestion[]),
    store.loadHumanReview(caseData).catch(() => null),
    store.listCaseUpdates(input.caseId).catch(() => [] as ChatContextUpdate[]),
  ]);

  const pendingRows = trailingUserMessages(rows);
  if (!pendingRows.length) return { status: "nothing_pending", message: null };
  const lastUserMessage = pendingRows[pendingRows.length - 1];

  const currentPending = pendingQuestions.filter((question) => question.status === "pending").sort((a, b) => a.order_index - b.order_index)[0] ?? null;
  const pendingAnswer = currentPending ? pendingAnswerFromTurn(pendingRows) : null;

  const candidates = selectChatImages({ pendingRows, caseImages: caseData.images, max: input.maxImages ?? 3 });
  const images = input.loadImages && candidates.length ? await input.loadImages(candidates) : { loaded: [], unavailable: candidates.map((candidate) => ({ ...candidate, reason: "não carregada" })) };

  const prompt = buildCaseChatPrompt({
    caseData,
    rows,
    humanReview,
    pendingQuestions,
    updates,
    images,
    likelyAnsweredPendingQuestion: pendingAnswer ? currentPending?.question ?? null : null,
  });

  const reply = await generateCaseChatReply({
    messages: prompt.messages,
    providers: input.providers,
    requestId: input.requestId,
    caseId: input.caseId,
    deadlineAt: input.deadlineAt,
    logger: input.logger,
  });

  // Concorrência: se outra requisição respondeu este turno enquanto a IA
  // gerava, não grava uma segunda resposta.
  const latest = await store.listMessages(input.caseId);
  const lastUserIndex = latest.findIndex((message) => message.id === lastUserMessage.id);
  const answeredMeanwhile = lastUserIndex >= 0 ? latest.slice(lastUserIndex + 1).find((message) => message.role === "assistant") : null;
  if (answeredMeanwhile) return { status: "already_answered", message: answeredMeanwhile };

  const saved = await store.insertMessage({
    caseId: input.caseId,
    userId: caseData.user_id ?? input.userId,
    role: "assistant",
    message: reply.text,
    replyToMessageId: lastUserMessage.id,
  });
  if (!saved) {
    const after = await store.listMessages(input.caseId);
    const existing = after.find((message) => message.role === "assistant" && message.reply_to_message_id === lastUserMessage.id) ?? null;
    return { status: "already_answered", message: existing };
  }

  // A fila de perguntas pendentes só avança depois de uma resposta real.
  let answeredPendingQuestionId: string | null = null;
  if (currentPending && pendingAnswer) {
    await store.answerPendingQuestion(currentPending.id, pendingAnswer).then(
      () => {
        answeredPendingQuestionId = currentPending.id;
      },
      () => null,
    );
  }

  return { status: "answered", message: saved, provider: reply.provider, model: reply.model, fallbackUsed: reply.fallbackUsed, answeredPendingQuestionId };
}

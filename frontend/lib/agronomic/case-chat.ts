/**
 * Regras puras do chat do caso (sem dependências de servidor).
 *
 * Persistência (tabela case_chat_messages, sem migration):
 * - texto            → message_type "text"
 * - cada foto        → message_type "image", file_url = foto
 * - áudio            → message_type "audio", file_url = áudio original
 * - transcrição      → message_type "transcription" logo após o áudio
 *   (ausente quando a transcrição falhou ou não está configurada)
 */

export type ChatMessageType = "text" | "image" | "audio" | "transcription";

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  message: string;
  message_type: ChatMessageType;
  file_url: string | null;
  created_at: string | null;
};

export const AUDIO_MESSAGE_LABEL = "Mensagem de áudio enviada pelo produtor.";
export const IMAGE_MESSAGE_LABEL = "Foto enviada pelo produtor durante a conversa.";

export type ChatTurnItem =
  | { kind: "text"; id: string; role: "user" | "assistant"; text: string; createdAt: string | null }
  | { kind: "image"; id: string; role: "user" | "assistant"; url: string; caption: string | null; createdAt: string | null }
  | {
      kind: "audio";
      id: string;
      role: "user" | "assistant";
      url: string | null;
      transcription: string | null;
      createdAt: string | null;
    };

/**
 * Agrupa as linhas do banco em itens de exibição: a transcrição é anexada ao
 * áudio que a precede; fotos viram miniaturas.
 */
export function buildChatTimeline(rows: ChatMessageRow[]): ChatTurnItem[] {
  const items: ChatTurnItem[] = [];
  for (const row of rows) {
    if (row.message_type === "transcription") {
      const previous = items[items.length - 1];
      if (previous && previous.kind === "audio" && previous.role === row.role && !previous.transcription) {
        previous.transcription = row.message;
        continue;
      }
      items.push({ kind: "text", id: row.id, role: row.role, text: row.message, createdAt: row.created_at });
      continue;
    }
    if (row.message_type === "audio") {
      // Registros antigos guardavam a transcrição no próprio texto do áudio.
      const legacyTranscription = row.message && row.message !== AUDIO_MESSAGE_LABEL && !/^Transcrição automática indisponível/i.test(row.message) ? row.message : null;
      items.push({ kind: "audio", id: row.id, role: row.role, url: row.file_url, transcription: legacyTranscription, createdAt: row.created_at });
      continue;
    }
    if (row.message_type === "image" && row.file_url) {
      const caption = row.message && row.message !== IMAGE_MESSAGE_LABEL && !/^Nova imagem enviada pelo usuário/i.test(row.message) ? row.message : null;
      items.push({ kind: "image", id: row.id, role: row.role, url: row.file_url, caption, createdAt: row.created_at });
      continue;
    }
    items.push({ kind: "text", id: row.id, role: row.role, text: row.message, createdAt: row.created_at });
  }
  return items;
}

/** Mensagens do usuário ainda sem resposta da IA (final da conversa). */
export function trailingUserMessages(rows: ChatMessageRow[]) {
  const trailing: ChatMessageRow[] = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].role === "assistant") break;
    trailing.unshift(rows[index]);
  }
  return trailing;
}

/** Texto de contexto enviado à IA para as novas entradas do usuário. */
export function buildUserTurnContext(rows: ChatMessageRow[]) {
  const parts: string[] = [];
  rows.forEach((row, index) => {
    if (row.message_type === "text") parts.push(row.message);
    if (row.message_type === "image") {
      parts.push(`Nova foto enviada pelo produtor durante a conversa (${row.file_url ?? "sem URL"}).${row.message && row.message !== IMAGE_MESSAGE_LABEL ? ` Observação: ${row.message}` : ""}`);
    }
    if (row.message_type === "audio") {
      const next = rows[index + 1];
      if (!next || next.message_type !== "transcription") {
        parts.push("O produtor enviou um áudio, mas a transcrição automática não foi concluída. Peça, se necessário, que ele escreva os pontos principais.");
      }
    }
    if (row.message_type === "transcription") parts.push(`Resposta por áudio (transcrição automática): ${row.message}`);
  });
  return parts.join("\n").trim();
}

export function chatErrorMessage(status: number, fallback?: string | null) {
  if (status === 401) return "Sua sessão expirou. Faça login novamente; sua mensagem continua no campo.";
  if (status === 402) return fallback || "Você atingiu o limite de perguntas à IA do seu plano neste ciclo.";
  if (status === 413) return "Os anexos ficaram grandes demais para envio. Remova uma foto ou grave um áudio mais curto.";
  if (status >= 500) return fallback || "A IA não respondeu agora. Tente novamente em instantes.";
  return fallback || "Não foi possível enviar a mensagem.";
}

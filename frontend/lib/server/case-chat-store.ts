/**
 * Implementação Supabase (PostgREST) do CaseChatStore. Todas as leituras e
 * gravações usam o token do próprio usuário: a RLS do banco é a segunda
 * barreira de isolamento (a primeira é `assertCaseChatAccess`).
 *
 * Compatibilidade de deploy: se a migration 20261008120000 (colunas
 * client_message_id / reply_to_message_id) ainda não foi aplicada, o store
 * continua funcionando sem essas colunas.
 */

import { buildClientHumanReview, type StoredHumanReview } from "../agronomic/client-review";
import type { ChatContextCase, ChatContextPendingQuestion, ChatContextUpdate } from "../agronomic/case-chat-context";
import type { CaseChatStore, NewChatMessage, StoredChatMessage } from "./case-chat-service";
import { SupabaseRestError, supabaseRequest } from "./supabase-rest";

const BASE_COLUMNS = "id,case_id,user_id,role,message,message_type,file_url,created_at";
const EXTENDED_COLUMNS = `${BASE_COLUMNS},client_message_id,reply_to_message_id`;

let extendedColumns: boolean | null = null;

function isMissingColumnError(error: unknown) {
  if (!(error instanceof SupabaseRestError)) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /client_message_id|reply_to_message_id/.test(`${error.message} ${error.details ?? ""}`)
  );
}

function isUniqueViolation(error: unknown) {
  return error instanceof SupabaseRestError && (error.code === "23505" || error.status === 409);
}

/** Apenas para testes. */
export function resetCaseChatStoreColumnCache() {
  extendedColumns = null;
}

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

export function describeCaseUpdate(log: { action: string; metadata: Record<string, unknown> | null }) {
  const metadata = log.metadata ?? {};
  const kind = typeof metadata.kind === "string" ? metadata.kind : null;
  if (kind === "attachment_added") return metadata.attachment === "soil_analysis" ? "produtor anexou análise de solo" : "produtor anexou nova foto ao caso";
  if (kind === "case_updated" || log.action === "Usuário editou") {
    const fields = Array.isArray(metadata.fields) ? (metadata.fields as string[]).map((field) => FIELD_LABELS[field] ?? field) : [];
    return fields.length ? `produtor editou o caso (${fields.join(", ")})` : "produtor editou o caso";
  }
  return null;
}

export function createSupabaseCaseChatStore(input: {
  token: string;
  fetchCase: (caseId: string, token: string) => Promise<(ChatContextCase & { user_id?: string | null; human_review_status?: string | null }) | null>;
}): CaseChatStore {
  const { token } = input;

  async function listMessages(caseId: string) {
    const query = (columns: string) =>
      supabaseRequest<StoredChatMessage[]>(
        `/rest/v1/case_chat_messages?case_id=eq.${encodeURIComponent(caseId)}&select=${columns}&order=created_at.asc,id.asc`,
        { method: "GET" },
        token,
      );
    if (extendedColumns !== false) {
      try {
        const rows = await query(EXTENDED_COLUMNS);
        extendedColumns = true;
        return rows;
      } catch (error) {
        if (!isMissingColumnError(error)) throw error;
        extendedColumns = false;
      }
    }
    return query(BASE_COLUMNS);
  }

  return {
    loadCase: (caseId) => input.fetchCase(caseId, token),
    listMessages,

    async findUserTextByClientId(caseId, clientMessageId) {
      if (extendedColumns === false) return null;
      const rows = await supabaseRequest<StoredChatMessage[]>(
        `/rest/v1/case_chat_messages?case_id=eq.${encodeURIComponent(caseId)}&client_message_id=eq.${encodeURIComponent(clientMessageId)}&role=eq.user&message_type=eq.text&select=${BASE_COLUMNS}&limit=1`,
        { method: "GET" },
        token,
      ).catch((error) => {
        if (isMissingColumnError(error)) extendedColumns = false;
        return [] as StoredChatMessage[];
      });
      return rows[0] ?? null;
    },

    async insertMessage(message: NewChatMessage) {
      const base = {
        case_id: message.caseId,
        user_id: message.userId,
        role: message.role,
        message: message.message,
        message_type: message.messageType ?? "text",
        file_url: message.fileUrl ?? null,
      };
      const extended = {
        ...base,
        ...(message.clientMessageId ? { client_message_id: message.clientMessageId } : {}),
        ...(message.replyToMessageId ? { reply_to_message_id: message.replyToMessageId } : {}),
      };
      const insert = (body: Record<string, unknown>, columns: string) =>
        supabaseRequest<StoredChatMessage[]>(
          `/rest/v1/case_chat_messages?select=${columns}`,
          { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) },
          token,
        );
      const wantsExtended = extendedColumns !== false && (message.clientMessageId || message.replyToMessageId);
      try {
        const rows = wantsExtended ? await insert(extended, EXTENDED_COLUMNS) : await insert(base, BASE_COLUMNS);
        return rows[0] ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        if (wantsExtended && isMissingColumnError(error)) {
          extendedColumns = false;
          const rows = await insert(base, BASE_COLUMNS);
          return rows[0] ?? null;
        }
        throw error;
      }
    },

    listPendingQuestions(caseId) {
      return supabaseRequest<ChatContextPendingQuestion[]>(
        `/rest/v1/case_pending_questions?case_id=eq.${encodeURIComponent(caseId)}&select=id,case_id,question,answer,status,order_index,created_at,answered_at&order=order_index.asc`,
        { method: "GET" },
        token,
      );
    },

    async answerPendingQuestion(questionId, answer) {
      await supabaseRequest(
        `/rest/v1/case_pending_questions?id=eq.${encodeURIComponent(questionId)}&status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ answer: answer.slice(0, 4000), status: "answered", answered_at: new Date().toISOString() }),
        },
        token,
      );
    },

    async loadHumanReview(caseData) {
      const rows = await supabaseRequest<StoredHumanReview[]>(
        `/rest/v1/human_reviews?case_id=eq.${encodeURIComponent(caseData.id)}&select=id,case_id,specialist_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at&order=created_at.desc`,
        { method: "GET" },
        token,
      );
      // Só parecer FINALIZADO e liberado ao produtor entra no contexto.
      const review = buildClientHumanReview({ rows, humanReviewStatus: caseData.human_review_status ?? null });
      return review && (review.reviewText || review.technicalRecommendation || review.finalObservations) ? review : null;
    },

    async listCaseUpdates(caseId): Promise<ChatContextUpdate[]> {
      const rows = await supabaseRequest<Array<{ action: string; metadata: Record<string, unknown> | null; created_at: string | null }>>(
        `/rest/v1/case_activity_logs?case_id=eq.${encodeURIComponent(caseId)}&select=action,metadata,created_at&order=created_at.desc&limit=20`,
        { method: "GET" },
        token,
      );
      return rows
        .map((row) => ({ at: row.created_at, description: describeCaseUpdate(row) }))
        .filter((row): row is ChatContextUpdate => Boolean(row.description))
        .slice(0, 6);
    },
  };
}

/**
 * Banco em memória e provedores de IA falsos para testar o chat do caso de
 * ponta a ponta (gravação → contexto → inferência → persistência).
 */

import type { AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult } from "../../src/lib/ai/providers/types";
import type { ChatContextCase, ChatContextHumanReview, ChatContextPendingQuestion, ChatContextUpdate } from "../../lib/agronomic/case-chat-context";
import type { CaseChatStore, NewChatMessage, StoredChatMessage } from "../../lib/server/case-chat-service";

export type FakeCase = ChatContextCase & { user_id: string; human_review_status?: string | null };

export class MemoryChatDb {
  cases = new Map<string, FakeCase>();
  messages: StoredChatMessage[] = [];
  pending: Array<ChatContextPendingQuestion & { case_id: string }> = [];
  reviews = new Map<string, ChatContextHumanReview>();
  updates = new Map<string, ChatContextUpdate[]>();
  private seq = 0;
  private clock = Date.parse("2026-10-08T10:00:00.000Z");

  tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  /** Store visto por um usuário (simula a RLS: só lê casos do próprio dono). */
  storeFor(userId: string, hooks: { beforeAssistantInsert?: () => Promise<void> | void } = {}): CaseChatStore {
    const db = this;
    const ownCase = (caseId: string) => {
      const found = db.cases.get(caseId);
      return found && found.user_id === userId ? found : null;
    };
    return {
      async loadCase(caseId) {
        const found = db.cases.get(caseId);
        // Especialistas e outros usuários podem até "ver" o caso pela RLS; o
        // serviço precisa recusar quem não é dono.
        return found ? structuredClone(found) : null;
      },
      async listMessages(caseId) {
        if (!ownCase(caseId)) return [];
        return structuredClone(db.messages.filter((message) => message.case_id === caseId));
      },
      async findUserTextByClientId(caseId, clientMessageId) {
        return db.messages.find((message) => message.case_id === caseId && message.role === "user" && message.message_type === "text" && message.client_message_id === clientMessageId) ?? null;
      },
      async insertMessage(input: NewChatMessage) {
        const owned = ownCase(input.caseId);
        if (!owned || input.userId !== userId) throw new Error("RLS: inserção negada");
        if (input.role === "assistant" && hooks.beforeAssistantInsert) await hooks.beforeAssistantInsert();
        if (input.role === "assistant" && input.replyToMessageId && db.messages.some((message) => message.reply_to_message_id === input.replyToMessageId && message.role === "assistant")) {
          return null; // índice único case_chat_messages_reply_uidx
        }
        if (input.role === "user" && (input.messageType ?? "text") === "text" && input.clientMessageId && db.messages.some((message) => message.case_id === input.caseId && message.client_message_id === input.clientMessageId && message.message_type === "text")) {
          return null; // índice único case_chat_messages_client_text_uidx
        }
        const row: StoredChatMessage = {
          id: `msg-${++db.seq}`,
          case_id: input.caseId,
          user_id: input.userId,
          role: input.role,
          message: input.message,
          message_type: input.messageType ?? "text",
          file_url: input.fileUrl ?? null,
          created_at: db.tick(),
          client_message_id: input.clientMessageId ?? null,
          reply_to_message_id: input.replyToMessageId ?? null,
        };
        db.messages.push(row);
        return structuredClone(row);
      },
      async listPendingQuestions(caseId) {
        return structuredClone(db.pending.filter((question) => question.case_id === caseId));
      },
      async answerPendingQuestion(questionId, answer) {
        const question = db.pending.find((item) => item.id === questionId);
        if (question && question.status === "pending") {
          question.status = "answered";
          question.answer = answer;
        }
      },
      async loadHumanReview(caseData) {
        return db.reviews.get(caseData.id) ?? null;
      },
      async listCaseUpdates(caseId) {
        return db.updates.get(caseId) ?? [];
      },
    };
  }
}

export function makeCase(overrides: Partial<FakeCase> & { id: string; user_id: string }): FakeCase {
  return {
    crop: "Tomate",
    growth_stage: "Frutificação",
    symptoms: "Manchas marrons com anéis concêntricos nas folhas de baixo, amarelando ao redor.",
    history: "Irrigação por aspersão no fim da tarde. Chuvas frequentes na última semana.",
    soil_analysis_url: null,
    risk_level: "medium",
    ai_summary: "Triagem inicial de tomate com manchas foliares.",
    ai_analysis_json: {
      initialDiagnosis: "Manchas foliares em tomate compatíveis com doença fúngica favorecida por umidade.",
      detailedHypotheses: [
        { name: "Pinta-preta (Alternaria solani)", probability: "high", justification: "Anéis concêntricos em folhas velhas." },
        { name: "Septoriose (Septoria lycopersici)", probability: "medium", justification: "Manchas pequenas com centro claro." },
        { name: "Deficiência de potássio", probability: "low", justification: "Amarelecimento de bordas." },
      ],
      riskLevel: "medium",
      confidenceLevel: "medium",
      safeInitialRecommendations: ["Evitar molhar as folhas na irrigação."],
      analyzedAt: "2026-10-07T12:00:00.000Z",
    },
    farm: { name: "Sítio Boa Vista", city: "Holambra", state: "SP", area_hectares: 2, soil_type: "Argiloso" },
    images: [],
    crop_context: { display_name_pt: "Tomate", scientific_name: "Solanum lycopersicum" },
    ...overrides,
  };
}

export type ProviderCall = { messages: AIMessage[]; options: AIProviderCallOptions };

/**
 * Provedor falso: responde em função da PERGUNTA ATUAL e do histórico, para
 * provar que cada pergunta gera uma inferência nova com o contexto certo.
 */
export class ScriptedProvider implements AIProvider {
  readonly name: "openai" | "gemini";
  calls: ProviderCall[] = [];
  behavior: (call: ProviderCall) => Promise<string> | string;

  constructor(name: "openai" | "gemini", behavior: (call: ProviderCall) => Promise<string> | string) {
    this.name = name;
    this.behavior = behavior;
  }

  async generateText(messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<string>> {
    const call = { messages: structuredClone(messages), options };
    this.calls.push(call);
    const content = await this.behavior(call);
    return { provider: this.name, model: options.model ?? "fake", content, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, responseTimeMs: 1 };
  }
  async generateStructuredOutput<T>(): Promise<AIProviderResult<T>> {
    throw new Error("não usado no chat");
  }
  async generateEmbeddings(): Promise<AIProviderResult<number[][]>> {
    throw new Error("não usado no chat");
  }
  async analyzeImages(): Promise<AIProviderResult<string>> {
    throw new Error("não usado no chat");
  }
  async healthCheck() {
    return { provider: this.name, configured: true, ok: true };
  }
}

export function lastUserContent(call: ProviderCall) {
  return call.messages[call.messages.length - 1].content;
}

export function systemContent(call: ProviderCall) {
  return call.messages[0].content;
}

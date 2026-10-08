/**
 * Inferência do chat conversacional do caso.
 *
 * - Cada chamada é uma NOVA inferência com a pergunta atual e o histórico.
 * - Provedor principal e fallback recebem exatamente as mesmas mensagens.
 * - Não existe resposta fixa: se nenhum provedor responder, é lançado
 *   CaseChatAIError e a rota informa a falha ao usuário (a pergunta continua
 *   salva). Antes, a "triagem local segura" devolvia sempre o mesmo texto.
 * - Logs estruturados sem texto da conversa, imagens ou credenciais.
 */

import type { AIImageInput, AIMessage, AIProvider } from "../../src/lib/ai/providers/types";
import { normalizeAiResponseText } from "./ai-response-formatting";
import type { ChatImageCandidate, LoadedChatImage, UnavailableChatImage } from "./case-chat-context";

export type ChatProviderChoice = { provider: AIProvider; model: string };
export type ChatProviders = { primary: ChatProviderChoice | null; fallback: ChatProviderChoice | null };

export type CaseChatErrorCategory = "not_configured" | "timeout" | "provider_error" | "empty_response";

export class CaseChatAIError extends Error {
  category: CaseChatErrorCategory;
  attempts: Array<{ provider: string; model: string; category: CaseChatErrorCategory; durationMs: number }>;

  constructor(message: string, category: CaseChatErrorCategory, attempts: CaseChatAIError["attempts"] = []) {
    super(message);
    this.name = "CaseChatAIError";
    this.category = category;
    this.attempts = attempts;
  }
}

export type CaseChatReply = {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
};

export type CaseChatLogger = (event: string, data: Record<string, unknown>) => void;

export const defaultChatLogger: CaseChatLogger = (event, data) => {
  const level = data.status === "error" ? "warn" : "info";
  console[level](`[case-chat] ${event}`, JSON.stringify(data));
};

const DOSAGE_PATTERN = /\b\d+(?:[,.]\d+)?\s*(?:m\s*l|ml|l|litros?|g|gramas?|kg|quilos?)\s*(?:\/|por)\s*(?:ha|hectare|hectares|planta|plantas|litro|litros|l)\b/gi;
const DOSAGE_WARNING = "(dose omitida: consulte o rótulo/bula e um responsável técnico habilitado)";

/** Limpa a resposta do modelo preservando Markdown simples e quebras de linha. */
export function sanitizeChatReply(text: string) {
  const normalized = normalizeAiResponseText(text).replace(DOSAGE_PATTERN, DOSAGE_WARNING);
  return normalized.trim();
}

function categorize(error: unknown): CaseChatErrorCategory {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout|tempo limite|timed out/i.test(message)) return "timeout";
  if (/vazia|empty/i.test(message)) return "empty_response";
  return "provider_error";
}

/**
 * Gera a resposta da IA para o turno atual. `deadlineAt` (epoch ms) evita
 * estourar o tempo máximo da função serverless: o fallback só roda se ainda
 * houver tempo útil.
 */
export async function generateCaseChatReply(input: {
  messages: AIMessage[];
  providers: ChatProviders;
  requestId: string;
  caseId: string;
  deadlineAt?: number;
  logger?: CaseChatLogger;
  now?: () => number;
}): Promise<CaseChatReply> {
  const now = input.now ?? Date.now;
  const log = input.logger ?? defaultChatLogger;
  const deadlineAt = input.deadlineAt ?? now() + 50_000;
  const attempts: CaseChatAIError["attempts"] = [];
  const choices = [input.providers.primary, input.providers.fallback].filter((choice): choice is ChatProviderChoice => Boolean(choice));

  if (!choices.length) {
    log("ai_unavailable", { requestId: input.requestId, caseId: input.caseId, status: "error", errorCategory: "not_configured" });
    throw new CaseChatAIError("Nenhum provedor de IA está configurado.", "not_configured");
  }

  for (const [index, choice] of choices.entries()) {
    const remaining = deadlineAt - now();
    const isFallback = index > 0;
    if (isFallback && remaining < 8_000) {
      log("ai_fallback_skipped", { requestId: input.requestId, caseId: input.caseId, status: "error", reason: "deadline", remainingMs: remaining });
      break;
    }
    const timeoutMs = Math.max(5_000, Math.min(isFallback ? 22_000 : 30_000, remaining - 3_000));
    const startedAt = now();
    try {
      const result = await choice.provider.generateText(input.messages, {
        model: choice.model,
        promptType: "case_chat",
        maxOutputTokens: 2_500,
        temperature: 0.4,
        reasoningEffort: "low",
        timeoutMs,
      });
      const text = sanitizeChatReply(result.content || "");
      if (!text) throw new Error("A IA retornou uma resposta vazia.");
      const durationMs = now() - startedAt;
      log("ai_reply", {
        requestId: input.requestId,
        caseId: input.caseId,
        provider: result.provider,
        model: result.model,
        durationMs,
        status: "success",
        fallbackUsed: isFallback,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      return {
        text,
        provider: result.provider,
        model: result.model,
        fallbackUsed: isFallback,
        durationMs,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      };
    } catch (error) {
      const category = categorize(error);
      const durationMs = now() - startedAt;
      attempts.push({ provider: choice.provider.name, model: choice.model, category, durationMs });
      log("ai_attempt_failed", {
        requestId: input.requestId,
        caseId: input.caseId,
        provider: choice.provider.name,
        model: choice.model,
        durationMs,
        status: "error",
        errorCategory: category,
        fallbackUsed: isFallback,
        // Mensagem do provedor truncada (nunca contém a conversa nem chaves).
        providerMessage: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
    }
  }

  const last = attempts[attempts.length - 1];
  throw new CaseChatAIError("A IA não conseguiu responder agora.", last?.category ?? "provider_error", attempts);
}

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Baixa as fotos para enviar o CONTEÚDO ao modelo (base64). Só aceita URLs do
 * storage do próprio projeto (proteção contra SSRF). Fotos que não puderem ser
 * carregadas são informadas ao modelo como indisponíveis — ele não deve fingir
 * que as viu.
 */
export async function loadChatImages(
  candidates: ChatImageCandidate[],
  options: { allowedPrefix: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ loaded: LoadedChatImage[]; unavailable: UnavailableChatImage[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const loaded: LoadedChatImage[] = [];
  const unavailable: UnavailableChatImage[] = [];

  await Promise.all(
    candidates.map(async (candidate, index) => {
      if (!candidate.url.startsWith(options.allowedPrefix)) {
        unavailable[index] = { ...candidate, reason: "origem não permitida" };
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
      try {
        const response = await fetchImpl(candidate.url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          unavailable[index] = { ...candidate, reason: "arquivo não encontrado" };
          return;
        }
        const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
          unavailable[index] = { ...candidate, reason: mimeType.includes("hei") ? "formato HEIC não suportado pela IA" : "formato não suportado" };
          return;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
          unavailable[index] = { ...candidate, reason: "arquivo grande demais" };
          return;
        }
        const input: AIImageInput = { base64: buffer.toString("base64"), mimeType, description: candidate.label };
        loaded[index] = { ...candidate, input };
      } catch {
        unavailable[index] = { ...candidate, reason: "falha ao carregar" };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return { loaded: loaded.filter(Boolean), unavailable: unavailable.filter(Boolean) };
}

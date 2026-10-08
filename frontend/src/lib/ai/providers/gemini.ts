import { parseJsonObject } from "../utils/json-parser";
import { estimateMessagesTokens, estimateTokens } from "../utils/token-estimator";
import type { AIHealthCheck, AIImageInput, AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult } from "./types";

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL || process.env.GOOGLE_AI_MODEL || DEFAULT_GEMINI_MODEL;
}

/**
 * "gemini-2.5-pro" foi descontinuado para novas contas (o Google responde
 * "is no longer available to new users"), o que derrubava o fallback inteiro.
 * Quando o modelo configurado é recusado por indisponibilidade, a chamada é
 * repetida uma vez com GEMINI_FALLBACK_MODEL (padrão abaixo).
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";

export function getGeminiReplacementModel() {
  return process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_MODEL;
}

export function isGeminiModelUnavailableError(message: string | null | undefined) {
  return /no longer available|is not found|not found for API version|is not supported for generateContent|has been deprecated|deprecated/i.test(message ?? "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 35000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Converte o histórico para o formato do Gemini. O prompt de sistema vai em
 * `systemInstruction` (antes era repetido dentro de cada mensagem do usuário,
 * o que duplicava o contexto em conversas com várias mensagens). Imagens com
 * conteúdo base64 viram `inlineData`, para que o modelo veja a imagem.
 */
export function toGeminiRequest(messages: AIMessage[]) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");
  const contents = (conversation.length ? conversation : [{ role: "user" as const, content: system }]).map((message) => {
    const parts: Array<Record<string, unknown>> = [{ text: message.content }];
    for (const image of message.role === "user" ? message.images ?? [] : []) {
      if (image.base64 && image.mimeType) parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
    }
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });
  return {
    contents,
    ...(system && conversation.length ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

function getText(payload: any) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text)
    .filter(Boolean)
    .join("\n");

  if (!text?.trim()) {
    throw new Error("O Gemini retornou uma resposta vazia.");
  }

  return text;
}

function normalizeUsage(payload: any, fallbackInputTokens: number, outputText: string) {
  const inputTokens = payload.usageMetadata?.promptTokenCount ?? fallbackInputTokens;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? estimateTokens(outputText);
  return {
    inputTokens,
    outputTokens,
    totalTokens: payload.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;

  async generateText(messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<string>> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error("Configure GEMINI_API_KEY para usar Gemini.");
    }

    const requestedModel = options.model || getGeminiModel();
    const startedAt = Date.now();
    const request = toGeminiRequest(messages);
    const call = (model: string) =>
      fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            generationConfig: {
              temperature: options.temperature ?? 0.2,
              maxOutputTokens: options.maxOutputTokens ?? 1600,
              responseMimeType: options.promptType?.includes("structured") ? "application/json" : undefined
            }
          })
        },
        options.timeoutMs
      );

    let model = requestedModel;
    let response = await call(model);
    let payload = await response.json().catch(() => null);

    const replacement = getGeminiReplacementModel();
    if (!response.ok && isGeminiModelUnavailableError(payload?.error?.message) && replacement !== model) {
      console.warn("[ai-provider] modelo Gemini indisponível; usando modelo substituto", { requestedModel: model, replacementModel: replacement });
      model = replacement;
      response = await call(model);
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha na chamada do Gemini.");
    }

    const content = getText(payload);
    return {
      provider: this.name,
      model,
      content,
      usage: normalizeUsage(payload, estimateMessagesTokens(messages), content),
      responseTimeMs: Date.now() - startedAt,
      raw: payload
    };
  }

  async generateStructuredOutput<T>(messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<T>> {
    const result = await this.generateText(messages, { ...options, promptType: `${options.promptType ?? ""}:structured` });
    return { ...result, content: parseJsonObject<T>(result.content) };
  }

  async generateEmbeddings(): Promise<AIProviderResult<number[][]>> {
    throw new Error("Embeddings da plataforma usam OpenAI text-embedding-3-small como provider principal.");
  }

  async analyzeImages(images: AIImageInput[], prompt: string, options: AIProviderCallOptions = {}): Promise<AIProviderResult<string>> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error("Configure GEMINI_API_KEY para analisar imagens com Gemini.");
    }

    const imageParts = images.map((image) => {
      if (image.base64 && image.mimeType) {
        return { inlineData: { mimeType: image.mimeType, data: image.base64 } };
      }
      return { text: `Imagem para análise: ${image.url || image.description || "anexo sem URL"}` };
    });

    const model = options.model || getGeminiModel();
    const startedAt = Date.now();
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
          generationConfig: { temperature: options.temperature ?? 0.2, maxOutputTokens: options.maxOutputTokens ?? 1600 }
        })
      },
      options.timeoutMs
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha na análise multimodal do Gemini.");
    }

    const content = getText(payload);
    return {
      provider: this.name,
      model,
      content,
      usage: normalizeUsage(payload, estimateTokens(prompt), content),
      responseTimeMs: Date.now() - startedAt,
      raw: payload
    };
  }

  async healthCheck(): Promise<AIHealthCheck> {
    const configured = Boolean(getGeminiApiKey());
    return {
      provider: this.name,
      configured,
      ok: configured,
      model: getGeminiModel(),
      message: configured ? "Gemini configurado." : "GEMINI_API_KEY ausente."
    };
  }
}

export const geminiProvider = new GeminiProvider();

import { parseJsonObject } from "../utils/json-parser";
import { estimateMessagesTokens, estimateTokens } from "../utils/token-estimator";
import type { AIHealthCheck, AIImageInput, AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult } from "./types";

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY || null;
}

export function getOpenAiChatModel() {
  return process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";
}

export function getOpenAiComplexModel() {
  return process.env.OPENAI_COMPLEX_MODEL || "gpt-5.5";
}

export function getOpenAiEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTextFromResponse(payload: any) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output
    .flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
    .map((part: any) => part.text || part.output_text || "")
    .filter(Boolean)
    .join("\n");

  if (text.trim()) {
    return text;
  }

  const messageText = payload.choices?.[0]?.message?.content;
  if (typeof messageText === "string" && messageText.trim()) {
    return messageText;
  }

  throw new Error("A OpenAI retornou uma resposta vazia.");
}

function normalizeUsage(payload: any, fallbackInputTokens: number, fallbackOutputText = "") {
  const inputTokens = payload.usage?.input_tokens ?? payload.usage?.prompt_tokens ?? fallbackInputTokens;
  const outputTokens = payload.usage?.output_tokens ?? payload.usage?.completion_tokens ?? estimateTokens(fallbackOutputText);

  return {
    inputTokens,
    outputTokens,
    totalTokens: payload.usage?.total_tokens ?? inputTokens + outputTokens
  };
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;

  async generateText(messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<string>> {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("Configure OPENAI_API_KEY para usar a OpenAI.");
    }

    const model = options.model || getOpenAiChatModel();
    const startedAt = Date.now();
    const body = {
      model,
      input: messages.map((message) => ({ role: message.role, content: message.content })),
      temperature: options.temperature ?? 0.2,
      max_output_tokens: options.maxOutputTokens ?? 1400
    };

    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      options.timeoutMs
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha na chamada da OpenAI.");
    }

    const content = normalizeTextFromResponse(payload);
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
    const result = await this.generateText(messages, {
      ...options,
      maxOutputTokens: options.maxOutputTokens ?? 1600
    });

    return {
      ...result,
      content: parseJsonObject<T>(result.content)
    };
  }

  async generateEmbeddings(input: string | string[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<number[][]>> {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("Configure OPENAI_API_KEY para gerar embeddings.");
    }

    const model = options.model || getOpenAiEmbeddingModel();
    const startedAt = Date.now();
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, input, dimensions: 1536 })
      },
      options.timeoutMs
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha ao gerar embeddings na OpenAI.");
    }

    const content = (payload?.data ?? []).map((item: { embedding: number[] }) => item.embedding);
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error("A OpenAI retornou embeddings inválidos.");
    }

    const inputTokens = payload.usage?.prompt_tokens ?? estimateTokens(input);
    return {
      provider: this.name,
      model,
      content,
      usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
      responseTimeMs: Date.now() - startedAt,
      raw: payload
    };
  }

  async analyzeImages(images: AIImageInput[], prompt: string, options: AIProviderCallOptions = {}): Promise<AIProviderResult<string>> {
    const imageList = images.map((image, index) => `Imagem ${index + 1}: ${image.url || image.description || "anexo sem URL"}`).join("\n");
    return this.generateText([{ role: "user", content: `${prompt}\n\nImagens disponíveis para referência:\n${imageList}` }], options);
  }

  async healthCheck(): Promise<AIHealthCheck> {
    const configured = Boolean(getOpenAiApiKey());
    return {
      provider: this.name,
      configured,
      ok: configured,
      model: getOpenAiChatModel(),
      message: configured ? "OpenAI configurada." : "OPENAI_API_KEY ausente."
    };
  }
}

export const openAIProvider = new OpenAIProvider();

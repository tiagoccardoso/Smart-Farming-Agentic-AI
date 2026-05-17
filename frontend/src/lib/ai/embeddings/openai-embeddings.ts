import { openAIProvider } from "../providers/openai";

const embeddingCache = new Map<string, number[]>();

function normalizeEmbeddingInput(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

export async function generateOpenAIEmbedding(input: string) {
  const text = normalizeEmbeddingInput(input);
  if (!text) {
    throw new Error("Informe texto válido para gerar embedding.");
  }

  const cached = embeddingCache.get(text);
  if (cached) {
    return cached;
  }

  const result = await openAIProvider.generateEmbeddings(text, { promptType: "embedding", timeoutMs: 20000 });
  const embedding = result.content[0];
  embeddingCache.set(text, embedding);
  return embedding;
}

export function clearEmbeddingCache() {
  embeddingCache.clear();
}

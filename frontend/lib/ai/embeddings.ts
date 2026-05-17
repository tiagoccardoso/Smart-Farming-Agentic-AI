export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingVector = number[];

export type KnowledgeEmbeddingInput = {
  title?: string | null;
  category?: string | null;
  crop?: string | null;
  content?: string | null;
  fileUrl?: string | null;
};

function getEmbeddingApiKey() {
  return process.env.OPENAI_API_KEY || process.env.EMBEDDINGS_API_KEY || null;
}

function getEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || "text-embedding-3-small";
}

function sanitizeEmbeddingText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function areEmbeddingsConfigured() {
  return Boolean(getEmbeddingApiKey());
}

export function buildKnowledgeEmbeddingText(input: KnowledgeEmbeddingInput) {
  return [
    input.title ? `Título: ${sanitizeEmbeddingText(input.title)}` : null,
    input.category ? `Categoria: ${sanitizeEmbeddingText(input.category)}` : null,
    input.crop ? `Cultura: ${sanitizeEmbeddingText(input.crop)}` : null,
    input.content ? `Conteúdo técnico: ${sanitizeEmbeddingText(input.content)}` : null,
    input.fileUrl ? `Arquivo de referência: ${sanitizeEmbeddingText(input.fileUrl)}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateEmbedding(input: string): Promise<EmbeddingVector> {
  const apiKey = getEmbeddingApiKey();
  const text = sanitizeEmbeddingText(input);

  if (!apiKey) {
    throw new Error("Configure OPENAI_API_KEY ou EMBEDDINGS_API_KEY para gerar embeddings.");
  }

  if (!text) {
    throw new Error("Informe um texto válido para gerar embedding.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: text,
      dimensions: EMBEDDING_DIMENSIONS
    }),
    cache: "no-store"
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Não foi possível gerar embedding.");
  }

  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every((value) => typeof value === "number")) {
    throw new Error("O provedor de embeddings retornou um vetor inválido.");
  }

  return embedding;
}

export async function generateEmbeddingIfConfigured(input: string) {
  if (!areEmbeddingsConfigured() || !sanitizeEmbeddingText(input)) {
    return null;
  }

  return generateEmbedding(input);
}

export async function generateKnowledgeEmbedding(input: KnowledgeEmbeddingInput) {
  return generateEmbeddingIfConfigured(buildKnowledgeEmbeddingText(input));
}

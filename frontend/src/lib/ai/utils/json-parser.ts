export function extractJsonObject(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) {
    return fenced;
  }

  const object = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!object) {
    throw new Error("A IA não retornou um objeto JSON válido.");
  }

  return object;
}

export function parseJsonObject<T>(text: string): T {
  return JSON.parse(extractJsonObject(text)) as T;
}

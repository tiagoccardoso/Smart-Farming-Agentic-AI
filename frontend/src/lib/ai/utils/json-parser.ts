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
  const raw = extractJsonObject(text);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const repaired = raw
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([\{\s,])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "$1\"$2\":")
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ": \"$1\"");

    return JSON.parse(repaired) as T;
  }
}

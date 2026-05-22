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

function escapeNewlinesInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      result += ch;
      escaped = false;
    } else if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
    } else if (ch === "\"") {
      inString = !inString;
      result += ch;
    } else if (inString && ch === "\n") {
      result += "\\n";
    } else if (inString && ch === "\r") {
      result += "\\r";
    } else {
      result += ch;
    }
  }
  return result;
}

export function parseJsonObject<T>(text: string): T {
  const raw = extractJsonObject(text);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const repaired = escapeNewlinesInStrings(raw)
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([\{\s,])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "$1\"$2\":")
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ": \"$1\"");

    return JSON.parse(repaired) as T;
  }
}

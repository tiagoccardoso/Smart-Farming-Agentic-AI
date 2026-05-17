export * from "./types";
export * from "./openai";
export * from "./gemini";

import { geminiProvider } from "./gemini";
import { openAIProvider } from "./openai";

export function getPrimaryProvider() {
  return openAIProvider;
}

export function getFallbackProvider() {
  return geminiProvider;
}

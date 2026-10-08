/**
 * Provedores do chat: OpenAI (principal) e Gemini (fallback), preservando a
 * estratégia existente do projeto. O chat sempre usa o modelo de conversa
 * (OPENAI_CHAT_MODEL); a análise inicial continua com sua própria seleção.
 */

import { geminiProvider, getGeminiModel } from "../../src/lib/ai/providers/gemini";
import { getOpenAiChatModel, openAIProvider } from "../../src/lib/ai/providers/openai";
import type { ChatProviders } from "./case-chat-ai";

export function getCaseChatProviders(): ChatProviders {
  const openai = process.env.OPENAI_API_KEY ? { provider: openAIProvider, model: getOpenAiChatModel() } : null;
  const gemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? { provider: geminiProvider, model: getGeminiModel() } : null;
  return openai ? { primary: openai, fallback: gemini } : { primary: gemini, fallback: null };
}

export function estimateTokens(input: string | string[]) {
  const text = Array.isArray(input) ? input.join("\n") : input;
  if (!text.trim()) {
    return 0;
  }

  return Math.ceil(text.replace(/\s+/g, " ").trim().length / 4);
}

export function estimateMessagesTokens(messages: Array<{ content: string }>) {
  return messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);
}

const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5-mini": { input: 0.00015, output: 0.0006 },
  "gpt-5.5": { input: 0.0025, output: 0.01 },
  "text-embedding-3-small": { input: 0.00002, output: 0 },
  "gemini-2.5-pro": { input: 0.00125, output: 0.005 }
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const prices = COST_PER_1K_TOKENS[model] ?? { input: 0, output: 0 };
  return Number((((inputTokens / 1000) * prices.input) + ((outputTokens / 1000) * prices.output)).toFixed(6));
}

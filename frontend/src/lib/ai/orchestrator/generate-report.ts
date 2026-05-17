import { AGRONOMIC_SYSTEM_PROMPT } from "../prompts/agronomic-system";
import { HUMAN_REVIEW_SUPPORT_PROMPT } from "../prompts/human-review-support";
import { getOpenAiComplexModel, openAIProvider } from "../providers/openai";

export async function generateAgronomicReport(caseSummary: string) {
  return openAIProvider.generateText(
    [
      { role: "system", content: AGRONOMIC_SYSTEM_PROMPT },
      { role: "user", content: `${HUMAN_REVIEW_SUPPORT_PROMPT}\n\nCaso:\n${caseSummary}` }
    ],
    { model: getOpenAiComplexModel(), promptType: "human_review_report", maxOutputTokens: 2600, timeoutMs: 45000 }
  );
}

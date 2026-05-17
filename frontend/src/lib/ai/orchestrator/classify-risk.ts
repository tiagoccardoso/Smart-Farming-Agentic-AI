import type { AIRiskLevel } from "../providers/types";

type RiskCase = {
  symptoms?: string | null;
  history?: string | null;
  soil_analysis_url?: string | null;
  images?: unknown[];
};

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function classifyAgronomicRisk(caseData: RiskCase): AIRiskLevel {
  const text = `${caseData.symptoms ?? ""} ${caseData.history ?? ""}`.toLowerCase();
  const highRiskTerms = ["morte", "perda", "severo", "rápido", "rapido", "generalizado", "murcha", "necrose", "toda área", "alta infestação"];
  const mediumRiskTerms = ["mancha", "amarel", "praga", "lagarta", "ferrugem", "fung", "doença", "doenca", "reboleira", "queda"];

  if (containsAny(text, highRiskTerms) || (caseData.symptoms ?? "").trim().length < 20) {
    return "high";
  }

  if (containsAny(text, mediumRiskTerms) || !caseData.images?.length || !caseData.soil_analysis_url) {
    return "medium";
  }

  return "low";
}

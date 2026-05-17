import { AGRONOMIC_AI_DISCLAIMER } from "./agronomic-system";
import type { KnowledgeDocument } from "../providers/types";

type AgronomicPromptCase = {
  crop?: string | null;
  growth_stage?: string | null;
  symptoms?: string | null;
  history?: string | null;
  soil_analysis_url?: string | null;
  farm?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    area_hectares?: number | null;
    soil_type?: string | null;
  } | null;
  images?: Array<{ image_url?: string | null; image_type?: string | null }>;
};

export function buildAgronomicAnalysisPrompt(caseData: AgronomicPromptCase, question?: string, knowledge: KnowledgeDocument[] = []) {
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "não informada";
  const images = caseData.images?.length
    ? caseData.images.map((image, index) => `${index + 1}. ${image.image_url || "sem URL"} (${image.image_type || "tipo não informado"})`).join("\n")
    : "Nenhuma imagem anexada.";
  const knowledgeContext = knowledge.length
    ? knowledge
        .map((item, index) => [`${index + 1}. Título: ${item.title}`, `Categoria: ${item.category}`, `Cultura: ${item.crop || "geral"}`, `Conteúdo: ${item.content}`].join("\n"))
        .join("\n---\n")
    : "Nenhum conteúdo ativo e relevante da base specialist_knowledge foi encontrado para este caso.";
  const allowedSources = knowledge.length ? knowledge.map((item) => `- ${item.title} (${item.category})`).join("\n") : "- Nenhuma fonte fornecida.";

  return `Analise o caso agronômico abaixo e retorne somente JSON válido, sem markdown.

Dados do caso:
- Cultura: ${caseData.crop || "não informada"}
- Estádio: ${caseData.growth_stage || "não informado"}
- Sintomas: ${caseData.symptoms || "não informado"}
- Histórico de manejo: ${caseData.history || "não informado"}
- Fazenda: ${caseData.farm?.name || "não informada"}
- Localização: ${location}
- Área: ${caseData.farm?.area_hectares ? `${caseData.farm.area_hectares} ha` : "não informada"}
- Tipo de solo: ${caseData.farm?.soil_type || "não informado"}
- Análise de solo anexada: ${caseData.soil_analysis_url ? "sim" : "não"}
- Imagens:
${images}
${question?.trim() ? `- Pergunta complementar: ${question.trim()}` : ""}

Base specialist_knowledge relevante:
${knowledgeContext}

Fontes permitidas em knowledgeUsed:
${allowedSources}

Regras específicas:
- Use a base specialist_knowledge somente quando relevante.
- Não invente fontes; knowledgeUsed só pode conter títulos e categorias listados acima.
- Se houver risco médio ou alto, recomende revisão humana.
- Se faltarem informações, deixe claro quais perguntas devem ser respondidas.
- Não recomende aplicação exata de defensivos nem doses.

Formato obrigatório:
{
  "initialDiagnosis": "",
  "probableHypotheses": [],
  "missingQuestions": [],
  "riskLevel": "low | medium | high",
  "initialRecommendation": "",
  "whenToCallHumanSpecialist": "",
  "knowledgeUsed": [],
  "disclaimer": "${AGRONOMIC_AI_DISCLAIMER}"
}`;
}

import { searchSpecialistKnowledge } from "../embeddings/knowledge-search";
import { searchInternetForAgronomicCase } from "../research/internet-search";
import {
  AGRONOMIC_AI_DISCLAIMER,
  AGRONOMIC_SYSTEM_PROMPT,
} from "../prompts/agronomic-system";
import { buildAgronomicAnalysisPrompt } from "../prompts/agronomic-analysis";
import { getFallbackProvider, getPrimaryProvider } from "../providers";
import { getGeminiModel } from "../providers/gemini";
import { getOpenAiChatModel, getOpenAiComplexModel } from "../providers/openai";
import type {
  AgronomicAnalysisOutput,
  AIProvider,
  AIProviderResult,
  AIUsageLogInput,
  InternetResearchResult,
  KnowledgeDocument,
} from "../providers/types";
import { retry } from "../utils/retry";
import {
  estimateCost,
  estimateMessagesTokens,
  estimateTokens,
} from "../utils/token-estimator";
import { classifyAgronomicRisk } from "./classify-risk";
import { normalizeAiResponseText, normalizeAiTextFields } from "../../../../lib/agronomic/ai-response-formatting";

type AgronomicCaseForAI = {
  id?: string;
  user_id?: string | null;
  crop: string;
  growth_stage?: string | null;
  symptoms: string;
  history?: string | null;
  soil_analysis_url?: string | null;
  farm?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    area_hectares?: number | null;
    soil_type?: string | null;
  } | null;
  images: Array<{ image_url: string; image_type?: string | null }>;
  crop_context?: {
    name?: string | null;
    slug?: string | null;
    aliases?: string[] | null;
    model_label?: string | null;
    display_name_pt?: string | null;
    display_name_en?: string | null;
    scientific_name?: string | null;
    recommended_soil?: string | null;
    ideal_climate?: string | null;
    common_diseases?: string | null;
    common_pests?: string | null;
    growth_cycle?: string | null;
    irrigation_notes?: string | null;
    fertilization_notes?: string | null;
    recommended_region?: string | null;
    known_risks?: string | null;
    management_notes?: string | null;
  } | null;
};

export type AgronomicCaseComplexity =
  | "simple"
  | "medium"
  | "complex"
  | "heavy_multimodal";

type AnalyzeAgronomicCaseOptions = {
  question?: string;
  userId?: string | null;
  enableKnowledgeSearch?: boolean;
  logUsage?: boolean;
};

const responseCache = new Map<string, AgronomicAnalysisOutput>();

function isCacheEnabled() {
  return process.env.AGRONOMIC_AI_CACHE === "true";
}

function cacheKey(caseData: AgronomicCaseForAI, question?: string) {
  return JSON.stringify({
    id: caseData.id,
    crop: caseData.crop,
    symptoms: caseData.symptoms,
    history: caseData.history,
    question,
    cropContext: caseData.crop_context?.name,
  });
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function cropDisplayName(caseData: AgronomicCaseForAI) {
  return (
    caseData.crop_context?.display_name_pt ||
    caseData.crop_context?.name ||
    caseData.crop ||
    "cultura informada"
  );
}

function buildPopularSummary(
  caseData: AgronomicCaseForAI,
  riskLevel: "low" | "medium" | "high",
  internetResearch?: InternetResearchResult,
) {
  const cropName = cropDisplayName(caseData);
  const symptoms = caseData.symptoms?.trim() || "sintomas informados";
  const riskText =
    riskLevel === "high"
      ? "merece atenção rápida"
      : riskLevel === "medium"
        ? "merece acompanhamento de perto"
        : "parece exigir monitoramento, sem sinal claro de urgência alta pelos dados enviados";
  const internetNote =
    internetResearch?.status === "success"
      ? "A resposta também considerou uma pesquisa atual na internet."
      : "A pesquisa externa foi solicitada, mas ficou limitada nesta execução.";

  return `Em palavras simples: na cultura ${cropName}, os sinais descritos (${symptoms}) indicam algo que ${riskText}. Antes de qualquer aplicação ou gasto maior, observe se o problema está aumentando, registre fotos e compare plantas sadias e afetadas. ${internetNote}`;
}

function confidenceFromRisk(riskLevel: "low" | "medium" | "high") {
  return riskLevel === "low" ? "medium" : riskLevel === "medium" ? "medium" : "low";
}

export function classifyCaseComplexity(
  caseData: AgronomicCaseForAI,
  question?: string,
): AgronomicCaseComplexity {
  const text = `${caseData.crop} ${caseData.symptoms} ${caseData.history ?? ""} ${question ?? ""}`;
  const normalized = text.toLowerCase();
  const imageCount = caseData.images.length;
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
  const wantsLongReport = containsAny(normalized, [
    "relatório completo",
    "relatorio completo",
    "parecer",
    "revisão técnica",
    "revisao tecnica",
    "detalhado",
  ]);
  const symptomCount =
    (caseData.symptoms.match(/[,;.]| e /gi) ?? []).length + 1;
  const baseRisk = classifyAgronomicRisk(caseData);

  if (imageCount >= 6 || (imageCount >= 3 && text.length > 2500)) {
    return "heavy_multimodal";
  }

  if (
    text.length > 3500 ||
    wantsLongReport ||
    symptomCount >= 6 ||
    baseRisk === "high"
  ) {
    return "complex";
  }

  if (
    text.length > 900 ||
    imageCount > 0 ||
    hasSoilAnalysis ||
    symptomCount >= 3 ||
    baseRisk === "medium"
  ) {
    return "medium";
  }

  return "simple";
}

function selectProviderAndModel(complexity: AgronomicCaseComplexity) {
  if (complexity === "heavy_multimodal") {
    return { provider: getFallbackProvider(), model: getGeminiModel() };
  }

  if (complexity === "complex") {
    return { provider: getPrimaryProvider(), model: getOpenAiComplexModel() };
  }

  return { provider: getPrimaryProvider(), model: getOpenAiChatModel() };
}

function buildFallbackAnalysis(
  caseData: AgronomicCaseForAI,
  question?: string,
): AgronomicAnalysisOutput {
  const riskLevel = classifyAgronomicRisk(caseData);
  const confidenceLevel = confidenceFromRisk(riskLevel);
  const cropName = cropDisplayName(caseData);
  const location =
    [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") ||
    "localidade não informada";
  const hasImages = caseData.images.length > 0;
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
  const symptoms = caseData.symptoms?.trim() || "sintomas não detalhados";
  const cropDiseases = caseData.crop_context?.common_diseases;
  const cropPests = caseData.crop_context?.common_pests;
  const climate = caseData.crop_context?.ideal_climate;
  const soil = caseData.farm?.soil_type || caseData.crop_context?.recommended_soil;
  const missingQuestions = [
    "Qual porcentagem aproximada do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou estão distribuídos de forma uniforme?",
    "Houve chuva, irrigação intensa, calor extremo ou pulverização nos últimos 7 a 14 dias?",
    "As folhas novas e velhas apresentam o mesmo padrão?",
  ];

  if (!hasImages) {
    missingQuestions.push(
      "É possível anexar fotos próximas dos sintomas e fotos gerais do talhão?",
    );
  }
  if (!hasSoilAnalysis) {
    missingQuestions.push(
      "Há análise de solo recente com pH, matéria orgânica e nutrientes?",
    );
  }

  const detailedHypotheses = [
    {
      name: cropDiseases
        ? "Doença compatível com problemas recorrentes da cultura"
        : "Doença foliar ou radicular a confirmar",
      probability: confidenceLevel,
      justification: `Os sintomas relatados em ${cropName} (${symptoms}) podem estar associados a agentes bióticos, especialmente quando há evolução em manchas, lesões, murcha, amarelecimento ou distribuição progressiva no talhão. ${cropDiseases ? `Para esta cultura, o cadastro técnico cita como doenças comuns: ${cropDiseases}.` : "Sem confirmação visual/laboratorial, a hipótese permanece como triagem inicial."}`,
      favorableFactors: [
        "Sintomas descritos indicam alteração fisiológica ou sanitária que merece correlação com distribuição no talhão.",
        climate ? `Condições climáticas favoráveis/fora do ideal podem influenciar: ${climate}.` : "Chuva, umidade, calor e baixa ventilação podem acelerar vários patógenos.",
      ],
      uncertaintyFactors: [
        hasImages ? "As imagens precisam ser correlacionadas com inspeção de campo e evolução temporal." : "A ausência de imagens reduz a leitura de padrão visual, severidade e distribuição.",
        "Não há confirmação por lupa, microscopia, teste rápido ou avaliação presencial.",
      ],
      potentialImpact:
        riskLevel === "high"
          ? "Pode causar perda produtiva relevante se houver avanço rápido ou atingir fase sensível da cultura."
          : "Pode reduzir área fotossintética, vigor e uniformidade se evoluir sem monitoramento.",
    },
    {
      name: "Estresse nutricional, hídrico ou fitotoxicidade",
      probability: riskLevel === "high" ? "medium" : "medium",
      justification: `Alterações visuais semelhantes às relatadas também podem ocorrer por desequilíbrio nutricional, compactação, excesso/falta de água, deriva ou resposta a aplicações recentes. ${soil ? `O contexto de solo informado/recomendado (${soil}) deve ser comparado com análise recente e manejo de irrigação/adubação.` : "Sem análise de solo e histórico completo, essa hipótese não deve ser descartada."}`,
      favorableFactors: [
        "Estresses abióticos frequentemente aparecem após mudanças de clima, irrigação, adubação ou pulverização.",
        "Padrões uniformes, em linhas ou associados a manchas de solo favorecem causa de manejo/ambiente.",
      ],
      uncertaintyFactors: [
        "Faltam dados sobre início dos sintomas, operações recentes e distribuição espacial.",
        "Sintomas nutricionais podem se confundir com doenças e pragas em triagem remota.",
      ],
      potentialImpact:
        "Pode comprometer crescimento, pegamento, enchimento ou qualidade comercial, mas costuma responder melhor quando a causa de manejo é identificada cedo.",
    },
  ] as AgronomicAnalysisOutput["detailedHypotheses"];

  if (cropPests) {
    detailedHypotheses.push({
      name: "Pressão de pragas compatíveis com a cultura",
      probability: "medium",
      justification: `O cadastro técnico da cultura aponta pragas comuns (${cropPests}). Danos por pragas podem gerar manchas, raspagens, perfurações, deformações, murcha ou transmissão de viroses, dependendo do organismo envolvido.`,
      favorableFactors: [
        "Danos localizados, presença de insetos, exúvias, fezes ou sintomas em ponteiros favorecem essa hipótese.",
        "Histórico regional e estágio da cultura podem elevar a pressão de pragas.",
      ],
      uncertaintyFactors: [
        "Não há contagem de pragas, armadilhas, pano de batida ou inspeção detalhada enviada.",
        "Alguns sintomas de pragas se sobrepõem a doenças e estresses ambientais.",
      ],
      potentialImpact:
        "Pode reduzir estande, área foliar, sanidade e produtividade, além de aumentar risco de disseminação quando houver vetor.",
    });
  }

  const internetResearch = {
    status: "unavailable" as const,
    query: "",
    summary: "Pesquisa externa ainda não executada para este fallback local.",
    sources: [],
  };

  const fallbackInitialDiagnosis = `Pré-consultoria para ${cropName} em ${location}: os sinais relatados (${symptoms}) indicam um caso que merece triagem técnica estruturada. Ainda não é um diagnóstico definitivo, mas já permite levantar hipóteses úteis, separar causas prováveis e orientar próximos passos seguros antes de qualquer intervenção de alto impacto.`;

  return {
    popularSummary: buildPopularSummary(caseData, riskLevel, internetResearch),
    technicalDetails: [
      "Dados técnicos da triagem local segura:",
      `Cultura e local: ${cropName} em ${location}.`,
      `Sintomas relatados: ${symptoms}.`,
      `Estádio: ${caseData.growth_stage || "não informado"}. Solo/contexto: ${soil || "não informado"}.`,
      `Anexos: ${hasImages ? `${caseData.images.length} imagem(ns)` : "sem imagens"}; análise de solo ${hasSoilAnalysis ? "anexada" : "não anexada"}.`,
      `Hipóteses técnicas: ${detailedHypotheses.map((item) => `${item.name} (${item.probability}) - ${item.justification}`).join(" | ")}.`,
      `Impacto produtivo: ${riskLevel === "high" ? "alto se houver avanço rápido ou fase sensível" : riskLevel === "medium" ? "moderado e dependente da evolução" : "baixo a moderado, sujeito à evolução"}.`,
      "Recomendações seguras: monitorar evolução, registrar fotos, mapear distribuição e evitar aplicações sem confirmação técnica."
    ].join("\n\n"),
    initialDiagnosis: fallbackInitialDiagnosis,
    probableHypotheses: detailedHypotheses.map(
      (item) => `${item.name}: ${item.justification}`,
    ),
    detailedHypotheses,
    visualFindings: [
      hasImages
        ? "Há imagens anexadas; a avaliação deve comparar lesões próximas com fotos gerais do talhão para entender severidade e distribuição."
        : "Não há imagem anexada; a leitura visual fica limitada aos sintomas descritos pelo usuário.",
      `Sintomas informados: ${symptoms}.`,
      caseData.growth_stage
        ? `Estádio informado: ${caseData.growth_stage}, fator importante para estimar risco produtivo.`
        : "Estádio da cultura não informado, o que reduz precisão sobre impacto e urgência.",
    ],
    possibleCauses: [
      "Doenças favorecidas por umidade, baixa ventilação, inóculo regional ou tecido suscetível.",
      "Pragas ou vetores, especialmente quando há sintomas em reboleiras, bordaduras ou ponteiros.",
      "Estresses abióticos ligados a água, solo, nutrição, compactação, deriva ou fitotoxicidade.",
    ],
    missingQuestions,
    riskLevel,
    confidenceLevel,
    productionImpact:
      riskLevel === "high"
        ? "O impacto potencial é alto se a causa estiver avançando rapidamente, atingir fase reprodutiva/enchimento ou reduzir área foliar e estande. A prioridade é confirmar severidade e conter evolução sem decisões precipitadas."
        : riskLevel === "medium"
          ? "O impacto potencial é moderado: pode haver perda de vigor, área fotossintética, uniformidade e qualidade caso os sintomas avancem ou coincidam com fase sensível."
          : "O impacto potencial parece baixo a moderado no momento, mas depende da evolução dos sintomas e da porcentagem de plantas afetadas.",
    attentionPoints: [
      "Distribuição no talhão: reboleira, bordadura, linhas de plantio ou padrão uniforme mudam a interpretação.",
      "Velocidade de avanço dos sintomas nas próximas 24 a 72 horas.",
      "Relação com chuvas, irrigação, calor, geada, adubação ou pulverizações recentes.",
    ],
    initialRecommendation:
      riskLevel === "high"
        ? "Continue a triagem com registros objetivos, isole decisões de alto custo e priorize vistoria técnica antes de aplicações ou mudanças drásticas de manejo."
        : "Monitore evolução, fotografe plantas sadias e afetadas, compare áreas do talhão e organize histórico recente antes de qualquer intervenção corretiva.",
    safeInitialRecommendations: [
      "Registrar fotos próximas e panorâmicas no mesmo ponto por 2 a 3 dias para medir evolução.",
      "Marcar no talhão onde os sintomas começaram e estimar porcentagem de plantas afetadas.",
      "Verificar histórico dos últimos 14 dias: chuva/irrigação, pulverizações, adubação, variação térmica e operações mecânicas.",
      "Evitar mistura ou aplicação de defensivos controlados sem confirmação técnica e responsável habilitado.",
    ],
    whenToCallHumanSpecialist:
      riskLevel === "low"
        ? "A revisão humana é recomendada se houver aumento dos sintomas, decisão de manejo com custo relevante ou necessidade de confirmação para relatório técnico."
        : "A revisão humana é recomendada como continuidade especializada antes de aplicações, descarte de plantas, mudanças importantes de manejo ou quando o risco produtivo for relevante.",
    humanReviewReason:
      riskLevel === "low"
        ? "A IA consegue organizar a triagem inicial, mas a confirmação depende de observação de campo quando houver evolução ou decisão técnica."
        : "Há incerteza agronômica e potencial de impacto produtivo; um especialista pode confirmar sinais em campo, diferenciar causas parecidas e orientar manejo dentro das normas técnicas.",
    knowledgeUsed: [],
    internetResearch,
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer: question?.trim()
      ? `Sobre sua pergunta: a triagem deve combinar os sintomas relatados com distribuição no talhão, evolução recente e contexto de ${cropName}. Mesmo com incerteza, as hipóteses principais são sanitárias, pragas/vetores e estresse de manejo/ambiente; decisões de aplicação ou intervenção devem ser validadas por responsável técnico.`
      : undefined,
  };
}

function sanitizeAiSafetyText(value: string) {
  const warning =
    "Não posso indicar dosagem exata de defensivos. Consulte rótulo/bula, legislação aplicável e responsável técnico habilitado.";
  const normalized = normalizeAiResponseText(value);

  return normalizeAiResponseText(
    normalized.replace(
      /\b\d+(?:[,.]\d+)?\s*(?:m\s*l|ml|l|litros?|g|gramas?|kg|quilos?)\s*(?:\/|por)\s*(?:ha|hectare|hectares|planta|plantas|litro|litros|l)\b/gi,
      warning,
    ),
  );
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback.map(sanitizeAiSafetyText);
  }
  const normalized = value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map(sanitizeAiSafetyText);
  return normalized.length ? normalized : fallback.map(sanitizeAiSafetyText);
}

function normalizeKnowledgeUsed(value: unknown, allowed: KnowledgeDocument[]) {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowedMap = new Map(
    allowed.map((item) => [
      `${item.title}::${item.category}`.toLowerCase(),
      { title: item.title, category: item.category },
    ]),
  );
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const title =
        "title" in item && typeof item.title === "string"
          ? item.title.trim()
          : "";
      const category =
        "category" in item && typeof item.category === "string"
          ? item.category.trim()
          : "";
      return allowedMap.get(`${title}::${category}`.toLowerCase()) ?? null;
    })
    .filter((item): item is { title: string; category: string } =>
      Boolean(item),
    );
}

function normalizeInternetResearch(
  value: unknown,
  fallback: InternetResearchResult,
): InternetResearchResult {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status =
    result.status === "success" || result.status === "unavailable" || result.status === "error"
      ? result.status
      : fallback.status;
  const sources = Array.isArray(fallback.sources) ? fallback.sources : [];

  return {
    status,
    query:
      typeof result.query === "string" && result.query.trim()
        ? sanitizeAiSafetyText(result.query)
        : fallback.query,
    summary:
      typeof result.summary === "string" && result.summary.trim()
        ? sanitizeAiSafetyText(result.summary)
        : fallback.summary,
    sources,
  };
}

function normalizeConfidenceLevel(value: unknown, fallback: "low" | "medium" | "high") {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

function normalizeDetailedHypotheses(
  value: unknown,
  fallback: AgronomicAnalysisOutput["detailedHypotheses"],
) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const hypothesis = item as Record<string, unknown>;
      const name = typeof hypothesis.name === "string" ? sanitizeAiSafetyText(hypothesis.name) : "";
      const probability = normalizeConfidenceLevel(hypothesis.probability, "medium");
      const justification = typeof hypothesis.justification === "string" ? sanitizeAiSafetyText(hypothesis.justification) : "";
      const favorableFactors = normalizeStringArray(hypothesis.favorableFactors, []);
      const uncertaintyFactors = normalizeStringArray(hypothesis.uncertaintyFactors, []);
      const potentialImpact = typeof hypothesis.potentialImpact === "string" ? sanitizeAiSafetyText(hypothesis.potentialImpact) : "";

      if (!name || !justification) {
        return null;
      }

      return {
        name,
        probability,
        justification,
        favorableFactors,
        uncertaintyFactors,
        potentialImpact,
      };
    })
    .filter((item): item is AgronomicAnalysisOutput["detailedHypotheses"][number] => Boolean(item));

  return normalized.length ? normalized : fallback;
}

function normalizeSafeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? sanitizeAiSafetyText(value)
    : sanitizeAiSafetyText(fallback);
}


function truncateForBlock(value: string, maxLength: number) {
  const clean = sanitizeAiSafetyText(value).replace(/\s+\n/g, "\n").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

function bulletList(items: string[], emptyText = "Nenhum item estruturado foi retornado.") {
  const normalized = items.map((item) => sanitizeAiSafetyText(item)).filter(Boolean);
  return normalized.length ? normalized.map((item) => `- ${item}`).join("\n") : emptyText;
}

function sourceList(internetResearch: InternetResearchResult) {
  if (!internetResearch.sources.length) {
    return "- Nenhuma fonte externa estruturada foi retornada pelo provedor.";
  }

  return internetResearch.sources
    .map((source) => `- ${source.title}${source.url ? `: ${source.url}` : ""}`)
    .join("\n");
}

function knowledgeBlock(knowledge: KnowledgeDocument[]) {
  if (!knowledge.length) {
    return "Nenhum conteúdo interno relevante foi encontrado na base specialist_knowledge para esta consulta.";
  }

  return knowledge
    .map((item, index) => [
      `${index + 1}. ${item.title} (${item.category})${item.crop ? `, cultura: ${item.crop}` : ""}`,
      truncateForBlock(item.content, 2400),
    ].join("\n"))
    .join("\n\n");
}

function composeCompletePopularSummary(
  modelSummary: string,
  analysis: Omit<AgronomicAnalysisOutput, "popularSummary" | "technicalDetails">,
  knowledge: KnowledgeDocument[],
  internetResearch: InternetResearchResult,
) {
  const parts = [
    modelSummary,
    `Em termos práticos, o caso aponta risco ${analysis.riskLevel} e confiança ${analysis.confidenceLevel}. O principal é acompanhar a evolução dos sintomas, comparar plantas sadias e afetadas e evitar decisões de aplicação ou investimento alto sem confirmação técnica.`,
    analysis.probableHypotheses.length
      ? `As possibilidades mais importantes levantadas foram: ${analysis.probableHypotheses.join("; ")}.`
      : "A IA não recebeu hipóteses estruturadas suficientes, então a análise deve permanecer como triagem inicial.",
    analysis.productionImpact
      ? `Possível impacto: ${analysis.productionImpact}`
      : "O impacto produtivo depende da evolução, área afetada e fase da cultura.",
    analysis.safeInitialRecommendations.length
      ? `Próximos passos seguros: ${analysis.safeInitialRecommendations.join("; ")}.`
      : analysis.initialRecommendation,
    internetResearch.status === "success" && internetResearch.summary
      ? `O que a pesquisa na internet acrescentou: ${internetResearch.summary}`
      : `A pesquisa na internet foi solicitada, mas retornou status "${internetResearch.status}". Por isso, essa parte foi usada com cautela: ${internetResearch.summary}`,
    knowledge.length
      ? `O que a base interna acrescentou: ${knowledge.map((item) => `${item.title} (${item.category}): ${truncateForBlock(item.content, 900)}`).join(" | ")}`
      : "Nenhum material interno relevante foi encontrado; a resposta continua usando os dados do caso, cadastro da cultura e pesquisa externa disponível.",
    analysis.whenToCallHumanSpecialist,
  ].filter((item): item is string => Boolean(item && item.trim()));

  return normalizeAiResponseText(parts.join("\n\n"));
}

function composeCompleteTechnicalDetails(
  modelTechnicalDetails: string,
  analysis: Omit<AgronomicAnalysisOutput, "popularSummary" | "technicalDetails">,
  knowledge: KnowledgeDocument[],
  internetResearch: InternetResearchResult,
  caseData: AgronomicCaseForAI,
) {
  const detailedHypotheses = analysis.detailedHypotheses.length
    ? analysis.detailedHypotheses.map((item, index) => [
        `${index + 1}. ${item.name}: probabilidade ${item.probability}`,
        `Justificativa: ${item.justification}`,
        `Fatores favoráveis:\n${bulletList(item.favorableFactors)}`,
        `Fatores de incerteza:\n${bulletList(item.uncertaintyFactors)}`,
        `Impacto potencial: ${item.potentialImpact || "Não informado."}`,
      ].join("\n")).join("\n\n")
    : bulletList(analysis.probableHypotheses);

  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "não informada";
  const details = [
    "Dados técnicos completos",
    `Contexto do caso: cultura ${caseData.crop || "não informada"}; estádio ${caseData.growth_stage || "não informado"}; local ${location}; solo ${caseData.farm?.soil_type || "não informado"}; imagens ${caseData.images.length}; análise de solo ${caseData.soil_analysis_url ? "anexada" : "não anexada"}.`,
    modelTechnicalDetails,
    `Diagnóstico inicial: ${analysis.initialDiagnosis}`,
    `Nível de risco: ${analysis.riskLevel}. Nível de confiança: ${analysis.confidenceLevel}.`,
    `Impacto produtivo: ${analysis.productionImpact}`,
    `Achados visuais/relatados:\n${bulletList(analysis.visualFindings)}`,
    `Pontos de atenção:\n${bulletList(analysis.attentionPoints)}`,
    `Hipóteses detalhadas:\n${detailedHypotheses}`,
    `Possíveis causas:\n${bulletList(analysis.possibleCauses)}`,
    `Recomendações iniciais seguras:\n${bulletList(analysis.safeInitialRecommendations.length ? analysis.safeInitialRecommendations : [analysis.initialRecommendation])}`,
    `Perguntas ou informações pendentes:\n${bulletList(analysis.missingQuestions, "Nenhuma pergunta pendente estruturada foi retornada nesta etapa.")}`,
    `Quando acionar especialista: ${analysis.whenToCallHumanSpecialist}`,
    `Motivo técnico para revisão humana: ${analysis.humanReviewReason}`,
    `Pesquisa na internet\nStatus: ${internetResearch.status}\nConsulta: ${internetResearch.query || "não informada"}\nSíntese aproveitada: ${internetResearch.summary || "sem síntese externa disponível"}\nFontes:\n${sourceList(internetResearch)}`,
    `Base interna do sistema\n${knowledgeBlock(knowledge)}`,
    `Aviso de segurança: ${AGRONOMIC_AI_DISCLAIMER}`,
  ].filter((item) => item.trim()).join("\n\n");

  return normalizeAiResponseText(details);
}

function normalizeAnalysis(
  output: Partial<AgronomicAnalysisOutput>,
  fallback: AgronomicAnalysisOutput,
  knowledge: KnowledgeDocument[],
  internetResearch: InternetResearchResult,
  caseData: AgronomicCaseForAI,
): AgronomicAnalysisOutput {
  const riskLevel = normalizeConfidenceLevel(output.riskLevel, fallback.riskLevel);
  const detailedHypotheses = normalizeDetailedHypotheses(
    output.detailedHypotheses,
    fallback.detailedHypotheses,
  );
  const normalizedInternetResearch = normalizeInternetResearch(output.internetResearch, internetResearch);
  const baseWithoutLongBlocks: Omit<AgronomicAnalysisOutput, "popularSummary" | "technicalDetails"> = {
    initialDiagnosis: normalizeSafeText(output.initialDiagnosis, fallback.initialDiagnosis),
    probableHypotheses: normalizeStringArray(
      output.probableHypotheses,
      detailedHypotheses.map((item) => `${item.name}: ${item.justification}`),
    ),
    detailedHypotheses,
    visualFindings: normalizeStringArray(output.visualFindings, fallback.visualFindings),
    possibleCauses: normalizeStringArray(output.possibleCauses, fallback.possibleCauses),
    missingQuestions: normalizeStringArray(
      output.missingQuestions,
      fallback.missingQuestions,
    ),
    riskLevel,
    confidenceLevel: normalizeConfidenceLevel(
      output.confidenceLevel,
      fallback.confidenceLevel,
    ),
    productionImpact: normalizeSafeText(output.productionImpact, fallback.productionImpact),
    attentionPoints: normalizeStringArray(output.attentionPoints, fallback.attentionPoints),
    initialRecommendation: normalizeSafeText(
      output.initialRecommendation,
      fallback.initialRecommendation,
    ),
    safeInitialRecommendations: normalizeStringArray(
      output.safeInitialRecommendations,
      fallback.safeInitialRecommendations,
    ),
    whenToCallHumanSpecialist: normalizeSafeText(
      output.whenToCallHumanSpecialist,
      fallback.whenToCallHumanSpecialist,
    ),
    humanReviewReason: normalizeSafeText(
      output.humanReviewReason,
      fallback.humanReviewReason,
    ),
    knowledgeUsed: normalizeKnowledgeUsed(output.knowledgeUsed, knowledge),
    internetResearch: normalizedInternetResearch,
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer:
      typeof output.conversationalAnswer === "string" &&
      output.conversationalAnswer.trim()
        ? sanitizeAiSafetyText(output.conversationalAnswer)
        : fallback.conversationalAnswer,
  };
  const modelPopularSummary = normalizeSafeText(
    output.popularSummary,
    fallback.popularSummary,
  );
  const modelTechnicalDetails = normalizeSafeText(
    output.technicalDetails,
    fallback.technicalDetails || fallback.initialDiagnosis,
  );

  return normalizeAiTextFields({
    popularSummary: composeCompletePopularSummary(
      modelPopularSummary,
      baseWithoutLongBlocks,
      knowledge,
      normalizedInternetResearch,
    ),
    technicalDetails: composeCompleteTechnicalDetails(
      modelTechnicalDetails,
      baseWithoutLongBlocks,
      knowledge,
      normalizedInternetResearch,
      caseData,
    ),
    ...baseWithoutLongBlocks,
  });
}

async function writeUsageLog(input: AIUsageLogInput) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  ) {
    return;
  }

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/ai_usage_logs`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: input.userId,
        provider: input.provider,
        model: input.model,
        prompt_type: input.promptType,
        tokens_input: input.tokensInput,
        tokens_output: input.tokensOutput,
        estimated_cost: input.estimatedCost,
        response_time_ms: input.responseTimeMs,
        success: input.success,
        fallback_used: input.fallbackUsed,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.warn(
      "Não foi possível registrar ai_usage_logs.",
      await response.text(),
    );
  }
}

async function callProvider(
  provider: AIProvider,
  model: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  return retry(
    () =>
      provider.generateStructuredOutput<Partial<AgronomicAnalysisOutput>>(
        messages,
        {
          model,
          promptType: "agronomic_analysis",
          maxOutputTokens: 6500,
          timeoutMs: 60000,
        },
      ),
    { retries: 1, baseDelayMs: 600, timeoutMs: 65000 },
  );
}

async function logResult(
  result: AIProviderResult<unknown>,
  userId: string | null | undefined,
  fallbackUsed: boolean,
  success: boolean,
) {
  await writeUsageLog({
    userId,
    provider: result.provider,
    model: result.model,
    promptType: "agronomic_analysis",
    tokensInput: result.usage.inputTokens,
    tokensOutput: result.usage.outputTokens,
    estimatedCost: estimateCost(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
    ),
    responseTimeMs: result.responseTimeMs,
    success,
    fallbackUsed,
  });
}

export async function analyzeAgronomicCase(
  caseData: AgronomicCaseForAI,
  options: AnalyzeAgronomicCaseOptions = {},
): Promise<AgronomicAnalysisOutput> {
  const key = cacheKey(caseData, options.question);
  const cacheEnabled = isCacheEnabled();
  const cached = cacheEnabled ? responseCache.get(key) : null;
  if (cached) {
    return cached;
  }

  const complexity = classifyCaseComplexity(caseData, options.question);
  const [knowledge, internetResearch] = await Promise.all([
    options.enableKnowledgeSearch === false
      ? Promise.resolve([])
      : searchSpecialistKnowledge(caseData, options.question),
    searchInternetForAgronomicCase(caseData, options.question),
  ]);
  const fallback = {
    ...buildFallbackAnalysis(caseData, options.question),
    popularSummary: buildPopularSummary(caseData, classifyAgronomicRisk(caseData), internetResearch),
    internetResearch,
  };
  const prompt = buildAgronomicAnalysisPrompt(
    caseData,
    options.question,
    knowledge,
    internetResearch,
  );
  const messages = [
    { role: "system" as const, content: AGRONOMIC_SYSTEM_PROMPT },
    { role: "user" as const, content: prompt },
  ];
  const selected = selectProviderAndModel(complexity);

  try {
    const result = await callProvider(
      selected.provider,
      selected.model,
      messages,
    );
    const normalized = normalizeAnalysis(result.content, fallback, knowledge, internetResearch, caseData);
    if (options.logUsage !== false) {
      await logResult(result, options.userId ?? caseData.user_id, false, true);
    }
    if (cacheEnabled) responseCache.set(key, normalized);
    return normalized;
  } catch (primaryError) {
    console.warn(
      "Provider principal falhou; executando fallback Gemini.",
      primaryError,
    );
    const fallbackProvider = getFallbackProvider();
    const fallbackModel = getGeminiModel();

    try {
      const result = await callProvider(
        fallbackProvider,
        fallbackModel,
        messages,
      );
      const normalized = normalizeAnalysis(result.content, fallback, knowledge, internetResearch, caseData);
      if (options.logUsage !== false) {
        await logResult(result, options.userId ?? caseData.user_id, true, true);
      }
      if (cacheEnabled) responseCache.set(key, normalized);
      return normalized;
    } catch (fallbackError) {
      console.warn(
        "Fallback Gemini falhou; retornando triagem local segura.",
        fallbackError,
      );
      if (options.logUsage !== false) {
        await writeUsageLog({
          userId: options.userId ?? caseData.user_id,
          provider: "local",
          model: "safe-local-fallback",
          promptType: "agronomic_analysis",
          tokensInput: estimateMessagesTokens(messages),
          tokensOutput: estimateTokens(JSON.stringify(fallback)),
          estimatedCost: 0,
          responseTimeMs: 0,
          success: false,
          fallbackUsed: true,
        });
      }
      return fallback;
    }
  }
}

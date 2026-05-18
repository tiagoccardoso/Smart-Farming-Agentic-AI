import { searchSpecialistKnowledge } from "../embeddings/knowledge-search";
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
  KnowledgeDocument,
} from "../providers/types";
import { retry } from "../utils/retry";
import {
  estimateCost,
  estimateMessagesTokens,
  estimateTokens,
} from "../utils/token-estimator";
import { classifyAgronomicRisk } from "./classify-risk";

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
  const hasImages = caseData.images.length > 0;
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
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

  return {
    initialDiagnosis: `Triagem inicial para ${caseData.crop}: os sintomas precisam ser correlacionados com distribuição no talhão, histórico recente e condições de solo/clima antes de qualquer decisão técnica.`,
    probableHypotheses: [
      "Possível interação entre manejo, ambiente, nutrição, pragas ou doenças, ainda sem contexto suficiente para diagnóstico definitivo.",
      "A evolução e a distribuição dos sintomas no talhão são decisivas para separar causa biótica de estresse fisiológico.",
    ],
    missingQuestions,
    riskLevel,
    initialRecommendation:
      riskLevel === "high"
        ? "Priorize revisão humana e vistoria técnica antes de intervenção. Registre fotos, evolução diária e histórico de aplicações."
        : "Organize os dados faltantes, monitore a evolução e evite aplicações corretivas sem confirmação técnica.",
    whenToCallHumanSpecialist:
      riskLevel === "low"
        ? "Acione especialista se houver aumento dos sintomas, custo relevante ou decisão de manejo com risco."
        : "Acione especialista antes de aplicação, descarte de plantas, mudança importante de manejo ou emissão de recomendação técnica.",
    knowledgeUsed: [],
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer: question?.trim()
      ? `Sobre sua pergunta: ainda é necessário validar os dados faltantes e envolver especialista em caso de decisão técnica.`
      : undefined,
  };
}

function sanitizeAiSafetyText(value: string) {
  const warning =
    "Não posso indicar dosagem exata de defensivos. Consulte rótulo/bula, legislação aplicável e responsável técnico habilitado.";
  return value
    .replace(
      /\b\d+(?:[,.]\d+)?\s*(?:m\s*l|ml|l|litros?|g|gramas?|kg|quilos?)\s*(?:\/|por)\s*(?:ha|hectare|hectares|planta|plantas|litro|litros|l)\b/gi,
      warning,
    )
    .trim();
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map(sanitizeAiSafetyText);
  return normalized.length ? normalized : fallback;
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

function normalizeAnalysis(
  output: Partial<AgronomicAnalysisOutput>,
  fallback: AgronomicAnalysisOutput,
  knowledge: KnowledgeDocument[],
): AgronomicAnalysisOutput {
  const riskLevel =
    output.riskLevel === "low" ||
    output.riskLevel === "medium" ||
    output.riskLevel === "high"
      ? output.riskLevel
      : fallback.riskLevel;
  return {
    initialDiagnosis:
      typeof output.initialDiagnosis === "string" &&
      output.initialDiagnosis.trim()
        ? sanitizeAiSafetyText(output.initialDiagnosis)
        : fallback.initialDiagnosis,
    probableHypotheses: normalizeStringArray(
      output.probableHypotheses,
      fallback.probableHypotheses,
    ),
    missingQuestions: normalizeStringArray(
      output.missingQuestions,
      fallback.missingQuestions,
    ),
    riskLevel,
    initialRecommendation:
      typeof output.initialRecommendation === "string" &&
      output.initialRecommendation.trim()
        ? sanitizeAiSafetyText(output.initialRecommendation)
        : fallback.initialRecommendation,
    whenToCallHumanSpecialist:
      typeof output.whenToCallHumanSpecialist === "string" &&
      output.whenToCallHumanSpecialist.trim()
        ? sanitizeAiSafetyText(output.whenToCallHumanSpecialist)
        : fallback.whenToCallHumanSpecialist,
    knowledgeUsed: normalizeKnowledgeUsed(output.knowledgeUsed, knowledge),
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer:
      typeof output.conversationalAnswer === "string" &&
      output.conversationalAnswer.trim()
        ? sanitizeAiSafetyText(output.conversationalAnswer)
        : fallback.conversationalAnswer,
  };
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
          maxOutputTokens: 1800,
          timeoutMs: 40000,
        },
      ),
    { retries: 1, baseDelayMs: 600, timeoutMs: 45000 },
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
  const cached = responseCache.get(key);
  if (cached) {
    return cached;
  }

  const fallback = buildFallbackAnalysis(caseData, options.question);
  const complexity = classifyCaseComplexity(caseData, options.question);
  const shouldUseKnowledge =
    options.enableKnowledgeSearch !== false && complexity !== "simple";
  const knowledge = shouldUseKnowledge
    ? await searchSpecialistKnowledge(caseData, options.question)
    : [];
  const prompt = buildAgronomicAnalysisPrompt(
    caseData,
    options.question,
    knowledge,
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
    const normalized = normalizeAnalysis(result.content, fallback, knowledge);
    if (options.logUsage !== false) {
      await logResult(result, options.userId ?? caseData.user_id, false, true);
    }
    responseCache.set(key, normalized);
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
      const normalized = normalizeAnalysis(result.content, fallback, knowledge);
      if (options.logUsage !== false) {
        await logResult(result, options.userId ?? caseData.user_id, true, true);
      }
      responseCache.set(key, normalized);
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

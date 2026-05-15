import {
  AGRONOMIC_AI_DISCLAIMER,
  buildAgronomicConsultingPrompt
} from "../prompts/agronomic-consulting";

export type AgronomicFarm = {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  area_hectares: number | null;
  soil_type: string | null;
};

export type AgronomicCaseImage = {
  id: string;
  image_url: string;
  image_type: string | null;
  created_at: string | null;
};

export type AgronomicCase = {
  id: string;
  crop: string;
  growth_stage: string | null;
  symptoms: string;
  history: string | null;
  soil_analysis_url: string | null;
  status: string | null;
  created_at: string | null;
  farm_id: string | null;
  farm: AgronomicFarm | null;
  images: AgronomicCaseImage[];
};

export type AgronomicRiskLevel = "low" | "medium" | "high";

export type AgronomicPreAnalysis = {
  initialDiagnosis: string;
  probableHypotheses: string[];
  missingQuestions: string[];
  riskLevel: AgronomicRiskLevel;
  initialRecommendation: string;
  whenToCallHumanSpecialist: string;
  disclaimer: string;
  conversationalAnswer?: string;
};

type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

type CaseRow = Omit<AgronomicCase, "farm" | "images">;

type AuthenticatedUser = {
  id: string;
};


export function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para consultar casos.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

export async function supabaseRequest<T>(path: string, init: RequestInit, token: string, config = getSupabaseConfig()) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || "Erro ao comunicar com o Supabase.");
  }

  return payload as T;
}

export async function getAuthenticatedUser(token: string, config = getSupabaseConfig()) {
  return supabaseRequest<AuthenticatedUser>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config
  );
}

export async function fetchAgronomicCase(caseId: string, token: string) {
  const config = getSupabaseConfig();
  const encodedCaseId = encodeURIComponent(caseId);
  const cases = await supabaseRequest<CaseRow[]>(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&select=id,crop,growth_stage,symptoms,history,soil_analysis_url,status,created_at,farm_id&limit=1`,
    { method: "GET" },
    token,
    config
  );

  const agronomicCase = cases[0];

  if (!agronomicCase) {
    return null;
  }

  const [farms, images] = await Promise.all([
    agronomicCase.farm_id
      ? supabaseRequest<AgronomicFarm[]>(
          `/rest/v1/farms?id=eq.${encodeURIComponent(agronomicCase.farm_id)}&select=id,name,city,state,area_hectares,soil_type&limit=1`,
          { method: "GET" },
          token,
          config
        )
      : Promise.resolve([]),
    supabaseRequest<AgronomicCaseImage[]>(
      `/rest/v1/case_images?case_id=eq.${encodedCaseId}&select=id,image_url,image_type,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
      config
    )
  ]);

  return {
    ...agronomicCase,
    farm: farms[0] ?? null,
    images
  } satisfies AgronomicCase;
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function buildFallbackHypotheses(caseData: AgronomicCase) {
  const text = `${caseData.crop} ${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const hypotheses = new Set<string>();

  if (containsAny(text, ["mancha", "míldio", "ferrugem", "fung", "mofo", "lesão", "necrose"])) {
    hypotheses.add("Doença foliar favorecida por umidade, inóculo presente ou baixa aeração do dossel.");
  }

  if (containsAny(text, ["amarel", "clorose", "defici", "nitrog", "potáss", "fosfor", "folha velha", "folha nova"])) {
    hypotheses.add("Desequilíbrio nutricional ou limitação de absorção por pH, compactação, salinidade ou umidade inadequada.");
  }

  if (containsAny(text, ["inset", "praga", "lagarta", "pulg", "ácar", "mosca", "furos", "raspagem"])) {
    hypotheses.add("Ataque de pragas sugadoras ou mastigadoras, exigindo inspeção do baixeiro, ponteiros e reboleiras.");
  }

  if (containsAny(text, ["seca", "murch", "calor", "encharc", "chuva", "irrig", "estiagem"])) {
    hypotheses.add("Estresse hídrico ou climático causando sintomas fisiológicos e maior predisposição a doenças.");
  }

  if (containsAny(text, ["herbicida", "defensivo", "aplic", "pulver", "deriva", "fitotox"])) {
    hypotheses.add("Possível fitotoxicidade, deriva ou interação entre aplicação recente, clima e estádio da cultura.");
  }

  if (hypotheses.size === 0) {
    hypotheses.add("Triagem inicial inconclusiva: os sintomas podem estar associados a manejo, nutrição, pragas, doenças ou estresse ambiental.");
    hypotheses.add("Necessidade de correlacionar distribuição no talhão, evolução temporal e imagens de detalhes da planta.");
  }

  return Array.from(hypotheses).slice(0, 5);
}

function inferFallbackRisk(caseData: AgronomicCase): AgronomicRiskLevel {
  const text = `${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const highRiskTerms = ["morte", "perda", "severo", "rápido", "generalizado", "murcha", "necrose", "toda área", "alta infestação"];
  const mediumRiskTerms = ["mancha", "amarel", "praga", "lagarta", "ferrugem", "fung", "doença", "reboleira", "queda"];

  if (containsAny(text, highRiskTerms) || caseData.symptoms.trim().length < 20) {
    return "high";
  }

  if (containsAny(text, mediumRiskTerms) || caseData.images.length === 0 || !caseData.soil_analysis_url) {
    return "medium";
  }

  return "low";
}

function buildFallbackPreAnalysis(caseData: AgronomicCase, question?: string): AgronomicPreAnalysis {
  const riskLevel = inferFallbackRisk(caseData);
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "localidade não informada";
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
  const hasImages = caseData.images.length > 0;

  const missingQuestions = [
    "Qual porcentagem aproximada da área ou do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou estão distribuídos de forma uniforme?",
    "Houve chuva, irrigação intensa, geada, calor extremo ou aplicação de defensivos nos últimos 7 a 14 dias?",
    "As folhas novas e velhas apresentam o mesmo padrão de sintoma?"
  ];

  if (!hasImages) {
    missingQuestions.push("É possível anexar fotos próximas dos sintomas e fotos gerais do talhão para comparar a distribuição?");
  }

  if (!hasSoilAnalysis) {
    missingQuestions.push("Há análise de solo recente com pH, matéria orgânica, macro e micronutrientes?");
  }

  const questionText = question?.trim();

  return {
    initialDiagnosis: `Orientação inicial para ${caseData.crop} em ${location}: os sintomas relatados ainda precisam ser comparados com o padrão no talhão, histórico de manejo e condições recentes de clima antes de qualquer decisão.`,
    probableHypotheses: buildFallbackHypotheses(caseData),
    missingQuestions,
    riskLevel,
    initialRecommendation:
      riskLevel === "high"
        ? "Priorize vistoria presencial, registre a evolução diária, evite aplicações corretivas sem diagnóstico confirmado e não use produtos controlados sem avaliação profissional."
        : riskLevel === "medium"
          ? "Monitore a evolução por 24 a 48 horas, compare plantas sadias e afetadas, colete novas imagens e valide o histórico de irrigação, adubação e pulverizações."
          : "Mantenha observação sistemática, organize fotos e dados de manejo, e só avance para intervenção quando houver evidência técnica suficiente.",
    whenToCallHumanSpecialist:
      riskLevel === "low"
        ? "Chame um especialista se os sintomas aumentarem, surgirem perdas visíveis ou se houver decisão de manejo com custo ou risco relevante."
        : "Chame um especialista antes de tomar decisões de aplicação, uso de produto controlado, descarte de plantas ou mudanças importantes no manejo.",
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer: questionText
      ? `Sobre sua pergunta (“${questionText}”): responda primeiro às perguntas faltantes e compare o padrão no talhão. A orientação continua inicial; decisões de aplicação, dose ou intervenção devem ser revisadas por especialista.`
      : undefined
  };
}

function buildAgronomicPrompt(caseData: AgronomicCase, question?: string) {
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "não informada";
  const area = caseData.farm?.area_hectares ? `${caseData.farm.area_hectares} ha` : "não informada";
  const soilType = caseData.farm?.soil_type || "não informado";
  const images = caseData.images.length
    ? caseData.images.map((image, index) => `${index + 1}. ${image.image_url} (${image.image_type ?? "tipo não informado"})`).join("\n")
    : "Nenhuma foto anexada.";

  return buildAgronomicConsultingPrompt({
    cultura: caseData.crop || "não informada",
    localizacao: location,
    area,
    tipoDeSolo: soilType,
    sintomas: caseData.symptoms || "não informado",
    estagioDaCultura: caseData.growth_stage || "não informado",
    historico: caseData.history || "não informado",
    analiseDeSolo: caseData.soil_analysis_url ? `Disponível em ${caseData.soil_analysis_url}` : "não informada",
    fotosDisponiveis: images,
    perguntaComplementar: question
  });
}

function getConfiguredAiModel() {
  return process.env.AGRONOMIC_AI_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_AI_MODEL || "gemini-pro";
}

async function callConfiguredAiModel(prompt: string) {
  const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (!googleApiKey) {
    throw new Error("Configure GOOGLE_API_KEY ou GEMINI_API_KEY para gerar a pré-análise com IA.");
  }

  const model = getConfiguredAiModel();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(googleApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          responseMimeType: "application/json"
        }
      }),
      cache: "no-store"
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message || "O modelo de IA configurado não conseguiu gerar a pré-análise.");
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text)
    .filter(Boolean)
    .join("\n");

  if (!text) {
    throw new Error("O modelo de IA retornou uma resposta vazia.");
  }

  return text;
}

function parseModelJson(text: string) {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) {
    throw new Error("O modelo de IA não retornou JSON válido.");
  }

  return JSON.parse(jsonText) as Partial<AgronomicPreAnalysis>;
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRiskLevel(value: unknown, fallback: AgronomicRiskLevel): AgronomicRiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function normalizePreAnalysis(modelOutput: Partial<AgronomicPreAnalysis>, fallback: AgronomicPreAnalysis): AgronomicPreAnalysis {
  const riskLevel = normalizeRiskLevel(modelOutput.riskLevel, fallback.riskLevel);

  return {
    initialDiagnosis: typeof modelOutput.initialDiagnosis === "string" && modelOutput.initialDiagnosis.trim() ? modelOutput.initialDiagnosis.trim() : fallback.initialDiagnosis,
    probableHypotheses: normalizeStringArray(modelOutput.probableHypotheses, fallback.probableHypotheses),
    missingQuestions: normalizeStringArray(modelOutput.missingQuestions, fallback.missingQuestions),
    riskLevel,
    initialRecommendation:
      typeof modelOutput.initialRecommendation === "string" && modelOutput.initialRecommendation.trim()
        ? modelOutput.initialRecommendation.trim()
        : fallback.initialRecommendation,
    whenToCallHumanSpecialist:
      typeof modelOutput.whenToCallHumanSpecialist === "string" && modelOutput.whenToCallHumanSpecialist.trim()
        ? modelOutput.whenToCallHumanSpecialist.trim()
        : fallback.whenToCallHumanSpecialist,
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    conversationalAnswer: fallback.conversationalAnswer
  };
}

export async function generateAgronomicPreAnalysis(caseData: AgronomicCase, question?: string): Promise<AgronomicPreAnalysis> {
  const fallback = buildFallbackPreAnalysis(caseData, question);
  const modelText = await callConfiguredAiModel(buildAgronomicPrompt(caseData, question));
  const parsed = parseModelJson(modelText);
  return normalizePreAnalysis(parsed, fallback);
}

export async function updateAgronomicCaseWithAnalysis(caseId: string, token: string, analysis: AgronomicPreAnalysis) {
  const config = getSupabaseConfig();
  const encodedCaseId = encodeURIComponent(caseId);

  await supabaseRequest(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ai_summary: analysis.initialDiagnosis,
        ai_recommendation: analysis.initialRecommendation,
        risk_level: analysis.riskLevel,
        status: "ai_analyzed"
      })
    },
    token,
    config
  );
}

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

export type AgronomicRiskLevel = "baixo" | "médio" | "alto";

export type AgronomicPreAnalysis = {
  initialDiagnosis: string;
  probableHypotheses: string[];
  pendingQuestions: string[];
  riskLevel: AgronomicRiskLevel;
  initialRecommendation: string;
  nonSubstitutiveNotice: string;
  humanReviewSuggestion: string;
  conversationalAnswer?: string;
};

type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

type CaseRow = Omit<AgronomicCase, "farm" | "images">;

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

function buildHypotheses(caseData: AgronomicCase) {
  const text = `${caseData.crop} ${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const hypotheses = new Set<string>();

  if (containsAny(text, ["mancha", "míldio", "ferrugem", "fung", "mofo", "lesão", "necrose"])) {
    hypotheses.add("Doença foliar favorecida por umidade, inoculo presente ou baixa aeração do dossel.");
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

function inferRisk(caseData: AgronomicCase): AgronomicRiskLevel {
  const text = `${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const highRiskTerms = ["morte", "perda", "severo", "rápido", "generalizado", "murcha", "necrose", "toda área", "alta infestação"];
  const mediumRiskTerms = ["mancha", "amarel", "praga", "lagarta", "ferrugem", "fung", "doença", "reboleira", "queda"];

  if (containsAny(text, highRiskTerms)) {
    return "alto";
  }

  if (containsAny(text, mediumRiskTerms) || caseData.images.length > 0 || Boolean(caseData.soil_analysis_url)) {
    return "médio";
  }

  return "baixo";
}

export function generateAgronomicPreAnalysis(caseData: AgronomicCase, question?: string): AgronomicPreAnalysis {
  const riskLevel = inferRisk(caseData);
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "localidade não informada";
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
  const hasImages = caseData.images.length > 0;

  const pendingQuestions = [
    "Qual porcentagem aproximada da área ou do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou estão distribuídos de forma uniforme?",
    "Houve chuva, irrigação intensa, geada, calor extremo ou aplicação de defensivos nos últimos 7 a 14 dias?",
    "As folhas novas e velhas apresentam o mesmo padrão de sintoma?"
  ];

  if (!hasImages) {
    pendingQuestions.push("É possível anexar fotos próximas dos sintomas e fotos gerais do talhão para comparar a distribuição?");
  }

  if (!hasSoilAnalysis) {
    pendingQuestions.push("Há análise de solo recente com pH, matéria orgânica, macro e micronutrientes?");
  }

  const questionText = question?.trim();

  return {
    initialDiagnosis: `Orientação inicial para ${caseData.crop} em ${location}: os sintomas relatados indicam necessidade de diferenciar causas bióticas, nutricionais e ambientais antes de qualquer decisão de manejo.`,
    probableHypotheses: buildHypotheses(caseData),
    pendingQuestions,
    riskLevel,
    initialRecommendation:
      riskLevel === "alto"
        ? "Priorize vistoria presencial, registre a evolução diária, evite aplicações corretivas sem diagnóstico confirmado e isole decisões por talhão até revisão técnica."
        : riskLevel === "médio"
          ? "Monitore a evolução por 24 a 48 horas, compare plantas sadias e afetadas, colete novas imagens e valide o histórico de irrigação, adubação e pulverizações."
          : "Mantenha observação sistemática, organize fotos e dados de manejo, e só avance para intervenção quando houver evidência técnica suficiente.",
    nonSubstitutiveNotice:
      "Esta pré-análise é uma orientação inicial gerada por IA, baseada apenas nas informações enviadas, e não substitui diagnóstico agronômico presencial, receituário, laudo técnico ou responsabilidade profissional habilitada.",
    humanReviewSuggestion:
      riskLevel === "baixo"
        ? "A revisão humana é opcional neste momento, mas recomendada se os sintomas evoluírem ou se houver decisão de manejo com custo ou risco relevante."
        : "Como o risco foi classificado como médio ou alto, recomenda-se solicitar revisão da especialista antes de tomar decisões de manejo sensíveis.",
    conversationalAnswer: questionText
      ? `Sobre sua pergunta (“${questionText}”): pela triagem inicial, responda primeiro às perguntas pendentes e compare o padrão no talhão. A orientação continua sendo inicial; decisões de aplicação, dose ou intervenção devem ser revisadas por especialista, principalmente se o risco for ${riskLevel}.`
      : undefined
  };
}

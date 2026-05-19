import { analyzeAgronomicCase } from "../../src/lib/ai/orchestrator/analyze-case";
import {
  areEmbeddingsConfigured,
  generateEmbeddingIfConfigured,
} from "../ai/embeddings";
import { normalizeCropInput } from "../crop/normalization";
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
  case_id?: string | null;
  image_url: string;
  image_type: string | null;
  created_at: string | null;
};

export type AgronomicQuestionHistory = {
  id: string;
  case_id?: string | null;
  question: string;
  answer: string | null;
  created_at: string | null;
};

export type CropKnowledge = {
  id: string;
  name: string;
  slug: string | null;
  aliases: string[] | null;
  model_label: string | null;
  display_name_pt: string | null;
  display_name_en: string | null;
  scientific_name: string | null;
  recommended_soil: string | null;
  ideal_climate: string | null;
  common_diseases: string | null;
  common_pests: string | null;
  growth_cycle: string | null;
  irrigation_notes: string | null;
  fertilization_notes: string | null;
  recommended_region: string | null;
  known_risks: string | null;
  management_notes: string | null;
  active: boolean | null;
};

export type CaseChatMessageType = "text" | "image" | "audio" | "transcription";

export type AgronomicCaseChatMessage = {
  id: string;
  case_id: string;
  user_id: string;
  role: "user" | "assistant";
  message: string;
  message_type: CaseChatMessageType;
  file_url: string | null;
  created_at: string | null;
};

export type CasePendingQuestion = {
  id: string;
  case_id: string;
  question: string;
  answer: string | null;
  status: "pending" | "answered" | "skipped";
  order_index: number;
  created_at: string | null;
  answered_at: string | null;
};

export type AgronomicCase = {
  id: string;
  user_id?: string | null;
  crop: string;
  growth_stage: string | null;
  symptoms: string;
  history: string | null;
  soil_analysis_url: string | null;
  status: string | null;
  risk_level: AgronomicRiskLevel | null;
  ai_summary: string | null;
  ai_recommendation: string | null;
  ai_analysis_json?: AgronomicPreAnalysis | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  created_at: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  farm_id: string | null;
  farm: AgronomicFarm | null;
  images: AgronomicCaseImage[];
  question_history?: AgronomicQuestionHistory[];
  chat_messages?: AgronomicCaseChatMessage[];
  pending_questions?: CasePendingQuestion[];
  crop_context?: CropKnowledge | null;
};

export type AgronomicRiskLevel = "low" | "medium" | "high";
export type AgronomicConfidenceLevel = "low" | "medium" | "high";

export type AgronomicDetailedHypothesis = {
  name: string;
  probability: AgronomicConfidenceLevel;
  justification: string;
  favorableFactors: string[];
  uncertaintyFactors: string[];
  potentialImpact: string;
};

export type KnowledgeUsed = {
  title: string;
  category: string;
};

export type AgronomicPreAnalysis = {
  initialDiagnosis: string;
  probableHypotheses: string[];
  detailedHypotheses: AgronomicDetailedHypothesis[];
  visualFindings: string[];
  possibleCauses: string[];
  missingQuestions: string[];
  riskLevel: AgronomicRiskLevel;
  confidenceLevel: AgronomicConfidenceLevel;
  productionImpact: string;
  attentionPoints: string[];
  initialRecommendation: string;
  safeInitialRecommendations: string[];
  whenToCallHumanSpecialist: string;
  humanReviewReason: string;
  disclaimer: string;
  knowledgeUsed: KnowledgeUsed[];
  conversationalAnswer?: string;
};

type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

type CaseRow = Omit<
  AgronomicCase,
  | "farm"
  | "images"
  | "question_history"
  | "chat_messages"
  | "pending_questions"
  | "crop_context"
>;

type AuthenticatedUser = {
  id: string;
};

type SpecialistKnowledgeMaterial = {
  id: string;
  title: string | null;
  category: string | null;
  crop: string | null;
  content: string | null;
  file_url?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  similarity?: number | null;
};

type RankedKnowledgeMaterial = SpecialistKnowledgeMaterial & {
  relevanceScore: number;
  excerpt: string;
};

const AGRONOMIC_AI_DISCLAIMER =
  "As orientações geradas por IA são informativas e não substituem a avaliação de um profissional habilitado. Para decisões técnicas, aplicações de defensivos, laudos ou recomendações com responsabilidade profissional, solicite revisão humana.";
const EXACT_PESTICIDE_DOSAGE_WARNING =
  "Não posso indicar dosagem exata de defensivos. Consulte o rótulo/bula, a legislação aplicável e um responsável técnico habilitado antes de qualquer aplicação.";
const KNOWLEDGE_CATEGORY_PRIORITY = [
  "protocolo",
  "recomendacao",
  "manejo",
  "pragas",
  "doencas",
  "solo",
];
const KNOWLEDGE_CONTEXT_MAX_CHARS = 6000;
const KNOWLEDGE_ITEM_MAX_CHARS = 1200;
const KNOWLEDGE_MAX_ITEMS = 6;

export function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para consultar casos.",
    );
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

export async function supabaseRequest<T>(
  path: string,
  init: RequestInit,
  token: string,
  config = getSupabaseConfig(),
) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error_description ||
        payload?.error ||
        "Erro ao comunicar com o Supabase.",
    );
  }

  return payload as T;
}

export async function getAuthenticatedUser(
  token: string,
  config = getSupabaseConfig(),
) {
  return supabaseRequest<AuthenticatedUser>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config,
  );
}

function getSupabaseServerCredentials(
  fallbackToken: string,
  config = getSupabaseConfig(),
) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return { token: fallbackToken, config };
  }

  return {
    token: serviceRoleKey,
    config: { ...config, anonKey: serviceRoleKey },
  };
}

function normalizeForSearch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sanitizeKnowledgeContent(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function excerptKnowledgeContent(content: string) {
  return content.length > KNOWLEDGE_ITEM_MAX_CHARS
    ? `${content.slice(0, KNOWLEDGE_ITEM_MAX_CHARS).trim()}...`
    : content;
}

function getCaseSearchTerms(caseData: AgronomicCase, question?: string) {
  const text = normalizeForSearch(
    `${caseData.crop} ${caseData.growth_stage ?? ""} ${caseData.symptoms} ${caseData.history ?? ""} ${question ?? ""}`,
  );

  return Array.from(new Set(text.match(/[a-z0-9]{4,}/g) ?? [])).slice(0, 40);
}

function rankKnowledgeMaterial(
  material: SpecialistKnowledgeMaterial,
  caseData: AgronomicCase,
  terms: string[],
) {
  const category = normalizeForSearch(material.category);
  const crop = normalizeForSearch(material.crop);
  const caseCrop = normalizeForSearch(caseData.crop);
  const searchable = normalizeForSearch(
    `${material.title ?? ""} ${material.category ?? ""} ${material.crop ?? ""} ${material.content ?? ""}`,
  );
  let score = 0;

  const categoryPriority = KNOWLEDGE_CATEGORY_PRIORITY.indexOf(category);
  if (categoryPriority >= 0) {
    score += (KNOWLEDGE_CATEGORY_PRIORITY.length - categoryPriority) * 10;
  }

  if (caseCrop && crop.includes(caseCrop)) {
    score += 35;
  } else if (!crop) {
    score += 12;
  }

  for (const term of terms) {
    if (searchable.includes(term)) {
      score += 2;
    }
  }

  return score;
}

function sanitizePostgrestPattern(value: string) {
  return value
    .replace(/[(),*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCaseEmbeddingText(caseData: AgronomicCase, question?: string) {
  return [
    `Cultura: ${caseData.crop || "não informada"}`,
    caseData.growth_stage ? `Estádio: ${caseData.growth_stage}` : null,
    caseData.symptoms ? `Sintomas: ${caseData.symptoms}` : null,
    caseData.history ? `Histórico de manejo: ${caseData.history}` : null,
    caseData.farm?.soil_type
      ? `Tipo de solo: ${caseData.farm.soil_type}`
      : null,
    caseData.farm?.city || caseData.farm?.state
      ? `Localização: ${[caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/")}`
      : null,
    question?.trim() ? `Pergunta complementar: ${question.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeVectorForRpc(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function prepareSemanticKnowledge(materials: SpecialistKnowledgeMaterial[]) {
  let usedChars = 0;
  const selected: RankedKnowledgeMaterial[] = [];

  const ranked = materials
    .filter(
      (material) =>
        material.title?.trim() &&
        sanitizeKnowledgeContent(material.content).length > 0,
    )
    .map((material) => ({
      ...material,
      relevanceScore:
        typeof material.similarity === "number" ? material.similarity : 0,
      excerpt: excerptKnowledgeContent(
        sanitizeKnowledgeContent(material.content),
      ),
    }))
    .filter((material) => material.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const material of ranked) {
    if (selected.length >= KNOWLEDGE_MAX_ITEMS) {
      break;
    }

    const entrySize =
      material.excerpt.length +
      (material.title?.length ?? 0) +
      (material.category?.length ?? 0) +
      120;

    if (usedChars + entrySize > KNOWLEDGE_CONTEXT_MAX_CHARS) {
      continue;
    }

    selected.push(material);
    usedChars += entrySize;
  }

  return selected;
}

function buildKnowledgeSelectPath(caseData: AgronomicCase) {
  const filters = [
    "select=id,title,category,crop,content,file_url,active,created_at",
    "active=eq.true",
    "order=created_at.desc",
    "limit=80",
  ];
  const crop = sanitizePostgrestPattern(caseData.crop ?? "");

  if (crop) {
    filters.push(
      `or=${encodeURIComponent(`(crop.ilike.*${crop}*,crop.is.null,crop.eq.)`)}`,
    );
  } else {
    filters.push(`or=${encodeURIComponent("(crop.is.null,crop.eq.)")}`);
  }

  return `/rest/v1/specialist_knowledge?${filters.join("&")}`;
}

function selectRelevantKnowledge(
  materials: SpecialistKnowledgeMaterial[],
  caseData: AgronomicCase,
  question?: string,
) {
  const terms = getCaseSearchTerms(caseData, question);
  let usedChars = 0;
  const selected: RankedKnowledgeMaterial[] = [];

  const ranked = materials
    .filter(
      (material) =>
        material.active !== false &&
        material.title?.trim() &&
        sanitizeKnowledgeContent(material.content).length > 0,
    )
    .map((material) => ({
      ...material,
      relevanceScore: rankKnowledgeMaterial(material, caseData, terms),
      excerpt: excerptKnowledgeContent(
        sanitizeKnowledgeContent(material.content),
      ),
    }))
    .filter((material) => material.relevanceScore > 0)
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );

  for (const material of ranked) {
    if (selected.length >= KNOWLEDGE_MAX_ITEMS) {
      break;
    }

    const entrySize =
      material.excerpt.length +
      (material.title?.length ?? 0) +
      (material.category?.length ?? 0) +
      120;

    if (usedChars + entrySize > KNOWLEDGE_CONTEXT_MAX_CHARS) {
      continue;
    }

    selected.push(material);
    usedChars += entrySize;
  }

  return selected;
}

async function fetchSemanticSpecialistKnowledge(
  caseData: AgronomicCase,
  token: string,
  question?: string,
) {
  if (!areEmbeddingsConfigured()) {
    return null;
  }

  const embedding = await generateEmbeddingIfConfigured(
    buildCaseEmbeddingText(caseData, question),
  );

  if (!embedding) {
    return null;
  }

  const config = getSupabaseConfig();
  const serverCredentials = getSupabaseServerCredentials(token, config);
  const materials = await supabaseRequest<SpecialistKnowledgeMaterial[]>(
    "/rest/v1/rpc/match_specialist_knowledge",
    {
      method: "POST",
      body: JSON.stringify({
        query_embedding: normalizeVectorForRpc(embedding),
        match_count: KNOWLEDGE_MAX_ITEMS,
        crop_filter: caseData.crop || null,
      }),
    },
    serverCredentials.token,
    serverCredentials.config,
  );

  return prepareSemanticKnowledge(Array.isArray(materials) ? materials : []);
}

async function fetchFallbackSpecialistKnowledge(
  caseData: AgronomicCase,
  token: string,
  question?: string,
) {
  const config = getSupabaseConfig();
  const serverCredentials = getSupabaseServerCredentials(token, config);
  const materials = await supabaseRequest<SpecialistKnowledgeMaterial[]>(
    buildKnowledgeSelectPath(caseData),
    { method: "GET" },
    serverCredentials.token,
    serverCredentials.config,
  );

  return selectRelevantKnowledge(
    Array.isArray(materials) ? materials : [],
    caseData,
    question,
  );
}

export async function fetchRelevantSpecialistKnowledge(
  caseData: AgronomicCase,
  token: string,
  question?: string,
) {
  try {
    const semanticMaterials = await fetchSemanticSpecialistKnowledge(
      caseData,
      token,
      question,
    );

    if (semanticMaterials) {
      return semanticMaterials;
    }
  } catch (error) {
    console.warn(
      "Não foi possível usar embeddings para consultar specialist_knowledge; usando busca simples.",
      error,
    );
  }

  try {
    return await fetchFallbackSpecialistKnowledge(caseData, token, question);
  } catch (error) {
    console.warn(
      "Não foi possível carregar a base specialist_knowledge para a análise agronômica.",
      error,
    );
    return [];
  }
}

function mapKnowledgeUsed(
  materials: Array<Pick<SpecialistKnowledgeMaterial, "title" | "category">>,
): KnowledgeUsed[] {
  return materials
    .filter((material) => material.title?.trim() && material.category?.trim())
    .map((material) => ({
      title: material.title!.trim(),
      category: material.category!.trim(),
    }));
}

export async function fetchAgronomicCase(caseId: string, token: string) {
  const config = getSupabaseConfig();
  const encodedCaseId = encodeURIComponent(caseId);
  const cases = await supabaseRequest<CaseRow[]>(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&select=id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,ai_analysis_json,human_review_requested,human_review_status,created_at,updated_at,deleted_at,farm_id&limit=1`,
    { method: "GET" },
    token,
    config,
  );

  const agronomicCase = cases[0];

  if (!agronomicCase) {
    return null;
  }

  const [
    farms,
    images,
    questionHistory,
    chatMessages,
    pendingQuestions,
    cropContext,
  ] = await Promise.all([
    agronomicCase.farm_id
      ? supabaseRequest<AgronomicFarm[]>(
          `/rest/v1/farms?id=eq.${encodeURIComponent(agronomicCase.farm_id)}&select=id,name,city,state,area_hectares,soil_type&limit=1`,
          { method: "GET" },
          token,
          config,
        )
      : Promise.resolve([]),
    supabaseRequest<AgronomicCaseImage[]>(
      `/rest/v1/case_images?case_id=eq.${encodedCaseId}&select=id,image_url,image_type,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
      config,
    ),
    supabaseRequest<AgronomicQuestionHistory[]>(
      `/rest/v1/ai_question_history?case_id=eq.${encodedCaseId}&select=id,case_id,question,answer,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
      config,
    ),
    supabaseRequest<AgronomicCaseChatMessage[]>(
      `/rest/v1/case_chat_messages?case_id=eq.${encodedCaseId}&select=id,case_id,user_id,role,message,message_type,file_url,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
      config,
    ).catch(() => []),
    fetchCasePendingQuestions(agronomicCase.id, token).catch(() => []),
    fetchCropContext(agronomicCase.crop, token, config),
  ]);

  return {
    ...agronomicCase,
    farm: farms[0] ?? null,
    images,
    question_history: questionHistory,
    chat_messages: chatMessages,
    pending_questions: pendingQuestions,
    crop_context: cropContext,
  } satisfies AgronomicCase;
}

function cleanCropSearch(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/[(),*]/g, " ")
    .replace(/\s+/g, " ");
}

async function fetchCropContext(
  cropName: string | null | undefined,
  token: string,
  config = getSupabaseConfig(),
) {
  const crop = cleanCropSearch(cropName);

  if (!crop) {
    return null;
  }

  const serverCredentials = getSupabaseServerCredentials(token, config);
  const rows = await supabaseRequest<CropKnowledge[]>(
    "/rest/v1/crops?active=eq.true&select=id,name,slug,aliases,model_label,display_name_pt,display_name_en,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,active&limit=200",
    { method: "GET" },
    serverCredentials.token,
    serverCredentials.config,
  ).catch(() => []);

  const normalized = normalizeCropInput(crop, rows);
  return (normalized?.record as CropKnowledge | undefined) ?? null;
}

function summarizeCropContext(crop: CropKnowledge | null | undefined) {
  if (!crop) {
    return "Nenhum cadastro ativo em crops foi encontrado para a cultura informada.";
  }

  return [
    `Nome cadastrado: ${crop.display_name_pt || crop.name}`,
    crop.model_label
      ? `Label do modelo ML: ${crop.model_label}`
      : `Label do modelo ML: não suportada pelo recomendador`,
    crop.slug ? `Slug: ${crop.slug}` : null,
    crop.aliases?.length ? `Aliases: ${crop.aliases.join(", ")}` : null,
    crop.display_name_en ? `Nome em inglês: ${crop.display_name_en}` : null,
    crop.scientific_name ? `Nome científico: ${crop.scientific_name}` : null,
    crop.ideal_climate ? `Clima ideal: ${crop.ideal_climate}` : null,
    crop.recommended_soil ? `Solo recomendado: ${crop.recommended_soil}` : null,
    crop.growth_cycle ? `Ciclo: ${crop.growth_cycle}` : null,
    crop.recommended_region
      ? `Região recomendada: ${crop.recommended_region}`
      : null,
    crop.common_diseases ? `Doenças comuns: ${crop.common_diseases}` : null,
    crop.common_pests ? `Pragas comuns: ${crop.common_pests}` : null,
    crop.known_risks ? `Riscos conhecidos: ${crop.known_risks}` : null,
    crop.irrigation_notes ? `Irrigação: ${crop.irrigation_notes}` : null,
    crop.fertilization_notes ? `Adubação: ${crop.fertilization_notes}` : null,
    crop.management_notes ? `Manejo: ${crop.management_notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function buildFallbackHypotheses(caseData: AgronomicCase) {
  const text =
    `${caseData.crop} ${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const hypotheses = new Set<string>();

  if (
    containsAny(text, [
      "mancha",
      "míldio",
      "ferrugem",
      "fung",
      "mofo",
      "lesão",
      "necrose",
    ])
  ) {
    hypotheses.add(
      "Doença foliar favorecida por umidade, inóculo presente ou baixa aeração do dossel.",
    );
  }

  if (
    containsAny(text, [
      "amarel",
      "clorose",
      "defici",
      "nitrog",
      "potáss",
      "fosfor",
      "folha velha",
      "folha nova",
    ])
  ) {
    hypotheses.add(
      "Desequilíbrio nutricional ou limitação de absorção por pH, compactação, salinidade ou umidade inadequada.",
    );
  }

  if (
    containsAny(text, [
      "inset",
      "praga",
      "lagarta",
      "pulg",
      "ácar",
      "mosca",
      "furos",
      "raspagem",
    ])
  ) {
    hypotheses.add(
      "Ataque de pragas sugadoras ou mastigadoras, exigindo inspeção do baixeiro, ponteiros e reboleiras.",
    );
  }

  if (
    containsAny(text, [
      "seca",
      "murch",
      "calor",
      "encharc",
      "chuva",
      "irrig",
      "estiagem",
    ])
  ) {
    hypotheses.add(
      "Estresse hídrico ou climático causando sintomas fisiológicos e maior predisposição a doenças.",
    );
  }

  if (
    containsAny(text, [
      "herbicida",
      "defensivo",
      "aplic",
      "pulver",
      "deriva",
      "fitotox",
    ])
  ) {
    hypotheses.add(
      "Possível fitotoxicidade, deriva ou interação entre aplicação recente, clima e estádio da cultura.",
    );
  }

  if (hypotheses.size === 0) {
    hypotheses.add(
      "Triagem inicial inconclusiva: os sintomas podem estar associados a manejo, nutrição, pragas, doenças ou estresse ambiental.",
    );
    hypotheses.add(
      "Necessidade de correlacionar distribuição no talhão, evolução temporal e imagens de detalhes da planta.",
    );
  }

  return Array.from(hypotheses).slice(0, 5);
}

function inferFallbackRisk(caseData: AgronomicCase): AgronomicRiskLevel {
  const text = `${caseData.symptoms} ${caseData.history ?? ""}`.toLowerCase();
  const highRiskTerms = [
    "morte",
    "perda",
    "severo",
    "rápido",
    "generalizado",
    "murcha",
    "necrose",
    "toda área",
    "alta infestação",
  ];
  const mediumRiskTerms = [
    "mancha",
    "amarel",
    "praga",
    "lagarta",
    "ferrugem",
    "fung",
    "doença",
    "reboleira",
    "queda",
  ];

  if (
    containsAny(text, highRiskTerms) ||
    caseData.symptoms.trim().length < 20
  ) {
    return "high";
  }

  if (
    containsAny(text, mediumRiskTerms) ||
    caseData.images.length === 0 ||
    !caseData.soil_analysis_url
  ) {
    return "medium";
  }

  return "low";
}

function buildFallbackPreAnalysis(
  caseData: AgronomicCase,
  question?: string,
): AgronomicPreAnalysis {
  const riskLevel = inferFallbackRisk(caseData);
  const location =
    [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") ||
    "localidade não informada";
  const hasSoilAnalysis = Boolean(caseData.soil_analysis_url);
  const hasImages = caseData.images.length > 0;

  const missingQuestions = [
    "Qual porcentagem aproximada da área ou do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou estão distribuídos de forma uniforme?",
    "Houve chuva, irrigação intensa, geada, calor extremo ou aplicação de defensivos nos últimos 7 a 14 dias?",
    "As folhas novas e velhas apresentam o mesmo padrão de sintoma?",
  ];

  if (!hasImages) {
    missingQuestions.push(
      "É possível anexar fotos próximas dos sintomas e fotos gerais do talhão para comparar a distribuição?",
    );
  }

  if (!hasSoilAnalysis) {
    missingQuestions.push(
      "Há análise de solo recente com pH, matéria orgânica, macro e micronutrientes?",
    );
  }

  const questionText = question?.trim();

  return {
    initialDiagnosis: `Orientação inicial para ${caseData.crop} em ${location}: os sintomas relatados ainda precisam ser comparados com o padrão no talhão, histórico de manejo e condições recentes de clima antes de qualquer decisão.`,
    probableHypotheses: buildFallbackHypotheses(caseData),
    detailedHypotheses: buildFallbackHypotheses(caseData).slice(0, 3).map((hypothesis) => ({
      name: hypothesis.split(":")[0] || "Hipótese agronômica inicial",
      probability: riskLevel === "high" ? "low" : "medium",
      justification: hypothesis,
      favorableFactors: ["Sintomas relatados pelo produtor justificam investigação técnica contextualizada.", "Cultura, solo, clima, estágio e histórico de manejo podem direcionar a triagem."],
      uncertaintyFactors: ["Faltam confirmação presencial, distribuição no talhão e evolução temporal.", hasImages ? "Imagens precisam ser correlacionadas com inspeção de campo." : "Ausência de imagens limita a leitura visual."],
      potentialImpact: riskLevel === "high" ? "Pode causar perda produtiva relevante se avançar rapidamente." : "Pode afetar vigor, uniformidade e produtividade se evoluir sem acompanhamento.",
    })),
    visualFindings: [
      hasImages ? "Há imagens anexadas para apoiar a triagem visual." : "Sem imagens anexadas; leitura visual depende da descrição dos sintomas.",
      `Sintomas relatados: ${caseData.symptoms || "não detalhados"}.`,
    ],
    possibleCauses: ["Doenças favorecidas por clima e umidade.", "Pragas ou vetores associados à cultura.", "Estresse nutricional, hídrico, fitotoxicidade ou compactação."],
    missingQuestions,
    riskLevel,
    confidenceLevel: riskLevel === "high" ? "low" : "medium",
    productionImpact: riskLevel === "high" ? "Impacto potencial alto se houver avanço rápido, fase sensível ou área afetada elevada." : "Impacto potencial moderado e dependente da evolução, severidade e percentual de plantas afetadas.",
    attentionPoints: ["Distribuição dos sintomas no talhão.", "Velocidade de avanço nas próximas 24 a 72 horas.", "Relação com chuva, irrigação, pulverizações e adubação recentes."],
    initialRecommendation:
      riskLevel === "high"
        ? "Priorize vistoria presencial, registre a evolução diária, evite aplicações corretivas sem diagnóstico confirmado e não use produtos controlados sem avaliação profissional."
        : riskLevel === "medium"
          ? "Monitore a evolução por 24 a 48 horas, compare plantas sadias e afetadas, colete novas imagens e valide o histórico de irrigação, adubação e pulverizações."
          : "Mantenha observação sistemática, organize fotos e dados de manejo, e só avance para intervenção quando houver evidência técnica suficiente.",
    safeInitialRecommendations: [
      "Registrar fotos próximas e panorâmicas no mesmo ponto por 2 a 3 dias.",
      "Estimar porcentagem de plantas afetadas e mapear reboleiras, bordaduras ou linhas.",
      "Evitar aplicações ou misturas sem confirmação técnica e responsável habilitado.",
    ],
    whenToCallHumanSpecialist:
      riskLevel === "low"
        ? "Chame um especialista se os sintomas aumentarem, surgirem perdas visíveis ou se houver decisão de manejo com custo ou risco relevante."
        : "Chame um especialista antes de tomar decisões de aplicação, uso de produto controlado, descarte de plantas ou mudanças importantes no manejo.",
    humanReviewReason: riskLevel === "low"
      ? "A revisão humana complementa a triagem quando houver evolução ou decisão técnica relevante."
      : "A revisão humana ajuda a confirmar hipóteses parecidas em campo, estimar severidade e orientar manejo com responsabilidade técnica.",
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    knowledgeUsed: [],
    conversationalAnswer: questionText
      ? `Sobre sua pergunta (“${questionText}”): responda primeiro às perguntas faltantes e compare o padrão no talhão. A orientação continua inicial; decisões de aplicação, dose ou intervenção devem ser revisadas por especialista.`
      : undefined,
  };
}

function buildAgronomicPrompt(
  caseData: AgronomicCase,
  question?: string,
  specialistKnowledge: RankedKnowledgeMaterial[] = [],
) {
  const location =
    [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") ||
    "não informada";
  const farmName = caseData.farm?.name || "não informada";
  const area = caseData.farm?.area_hectares
    ? `${caseData.farm.area_hectares} ha`
    : "não informada";
  const soilType = caseData.farm?.soil_type || "não informado";
  const images = caseData.images.length
    ? caseData.images
        .map(
          (image, index) =>
            `${index + 1}. ${image.image_url} (${image.image_type ?? "tipo não informado"})`,
        )
        .join("\n")
    : "Nenhuma imagem anexada.";
  const attachmentSummary = [
    `Quantidade de imagens anexadas: ${caseData.images.length}`,
    `Análise de solo anexada: ${caseData.soil_analysis_url ? "sim" : "não"}`,
    caseData.soil_analysis_url
      ? `URL da análise de solo: ${caseData.soil_analysis_url}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const optionalQuestion = question?.trim()
    ? `\nPergunta complementar do usuário: ${question.trim()}`
    : "";
  const knowledgeContext = specialistKnowledge.length
    ? specialistKnowledge
        .map((material, index) =>
          [
            `${index + 1}. Título: ${material.title}`,
            `Categoria: ${material.category}`,
            `Cultura: ${material.crop?.trim() || "geral / sem cultura específica"}`,
            `Conteúdo: ${material.excerpt}`,
          ].join("\n"),
        )
        .join("\n---\n")
    : "Nenhum conteúdo ativo e relevante da base specialist_knowledge foi encontrado para este caso.";
  const allowedKnowledgeSources = specialistKnowledge.length
    ? mapKnowledgeUsed(specialistKnowledge)
        .map((material) => `- ${material.title} (${material.category})`)
        .join("\n")
    : "- Nenhuma fonte da base specialist_knowledge foi fornecida.";

  return `Você é um assistente de triagem agronômica inicial. Analise o caso com linguagem simples em português do Brasil.

Dados do caso:
- Cultura: ${caseData.crop || "não informada"}
- Estádio de desenvolvimento: ${caseData.growth_stage || "não informado"}
- Sintomas observados: ${caseData.symptoms || "não informado"}
- Histórico de manejo: ${caseData.history || "não informado"}
- Fazenda: ${farmName}
- Localização: ${location}
- Área: ${area}
- Tipo de solo: ${soilType}
- Análise de solo anexada: ${caseData.soil_analysis_url ? "sim" : "não"}
- Imagens relacionadas:
${images}${optionalQuestion}

Metadados de anexos (usar na análise):
${attachmentSummary}

Base de conhecimento specialist_knowledge disponível para este caso:
${knowledgeContext}

Fontes permitidas em knowledgeUsed:
${allowedKnowledgeSources}

Regras obrigatórias:
- Retorne somente JSON válido, sem markdown.
- Não indique dosagem exata de defensivos, taxa por hectare, calda, concentração ou quantidade por planta.
- Não recomende aplicação de produto controlado sem avaliação profissional e sem responsável técnico.
- Não emita laudo, parecer conclusivo ou diagnóstico definitivo.
- Não se apresente como responsável técnico e não substitua engenheiro agrônomo, consultor habilitado ou outro profissional competente.
- Use linguagem simples.
- Considere os anexos como parte obrigatória da triagem: use imagens e análise de solo (quando existir) para ajustar hipóteses, nível de risco, confiança e recomendações iniciais.
- Se existir análise de solo apenas como URL/arquivo sem conteúdo textual extraído, declare explicitamente essa limitação na resposta e mantenha perguntas objetivas para coletar os principais parâmetros do solo (pH, MO, macro e micronutrientes).
- Use a base specialist_knowledge apenas quando ela for relevante para o caso.
- Não invente fontes: preencha knowledgeUsed somente com títulos e categorias listados em "Fontes permitidas em knowledgeUsed".
- Se nenhuma fonte da base specialist_knowledge foi fornecida ou usada, retorne knowledgeUsed como array vazio.
- Classifique riskLevel somente como "low", "medium" ou "high".
- Use "low" para sintomas leves, informação suficiente e baixo impacto imediato.
- Use "medium" para incerteza relevante ou possibilidade de perda.
- Use "high" para risco de perda econômica, praga/doença agressiva, sintomas severos ou falta de dados críticos.
- A IA apenas sugere perguntas; o backend e a tabela case_pending_questions controlam oficialmente a fila, quais perguntas existem, quais foram respondidas e quais ainda estão pendentes.
- Se o contexto complementar informar que pendingQuestions.length === 0 ou que não existem perguntas pendentes oficiais restantes, retorne missingQuestions como [] e não gere novas perguntas genéricas, repetidas ou artificiais.
- Se ainda houver incerteza após o fim da fila oficial, trate como limitação natural da triagem remota, explique essa limitação na recomendação, sugira revisão humana somente quando necessário e não reinicie a investigação automaticamente.
- Na análise inicial, missingQuestions são apenas sugestões para o backend criar a fila progressiva; depois disso, não use missingQuestions para controlar o estado oficial da consulta.

Formato obrigatório:
{
  "initialDiagnosis": "",
  "probableHypotheses": [],
  "detailedHypotheses": [{ "name": "", "probability": "low | medium | high", "justification": "", "favorableFactors": [], "uncertaintyFactors": [], "potentialImpact": "" }],
  "visualFindings": [],
  "possibleCauses": [],
  "missingQuestions": [],
  "riskLevel": "low | medium | high",
  "confidenceLevel": "low | medium | high",
  "productionImpact": "",
  "attentionPoints": [],
  "initialRecommendation": "",
  "safeInitialRecommendations": [],
  "whenToCallHumanSpecialist": "",
  "humanReviewReason": "",
  "disclaimer": "${AGRONOMIC_AI_DISCLAIMER}",
  "knowledgeUsed": [
    {
      "title": "",
      "category": ""
    }
  ]
}`;
}

function getConfiguredAiModel() {
  return (
    process.env.AGRONOMIC_AI_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_AI_MODEL ||
    "gemini-pro"
  );
}

async function callConfiguredAiModel(prompt: string) {
  const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (!googleApiKey) {
    throw new Error(
      "Configure GOOGLE_API_KEY ou GEMINI_API_KEY para gerar a pré-análise com IA.",
    );
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
          responseMimeType: "application/json",
        },
      }),
      cache: "no-store",
    },
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        "O modelo de IA configurado não conseguiu gerar a pré-análise.",
    );
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
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) {
    throw new Error("O modelo de IA não retornou JSON válido.");
  }

  return JSON.parse(jsonText) as Partial<AgronomicPreAnalysis>;
}

function sanitizeAiSafetyText(value: string) {
  const exactDosagePattern =
    /\b\d+(?:[,.]\d+)?\s*(?:m\s*l|ml|l|litros?|g|gramas?|kg|quilos?)\s*(?:\/|por)\s*(?:ha|hectare|hectares|planta|plantas|litro|litros|l)\b/gi;
  const sanitized = value.replace(
    exactDosagePattern,
    EXACT_PESTICIDE_DOSAGE_WARNING,
  );

  if (
    sanitized !== value &&
    !sanitized.includes(EXACT_PESTICIDE_DOSAGE_WARNING)
  ) {
    return `${sanitized.trim()} ${EXACT_PESTICIDE_DOSAGE_WARNING}`.trim();
  }

  return sanitized.trim();
}

function normalizeSafeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? sanitizeAiSafetyText(value)
    : fallback;
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
    .map((item) => sanitizeAiSafetyText(item));
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRiskLevel(
  value: unknown,
  fallback: AgronomicRiskLevel,
): AgronomicRiskLevel {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

function normalizeKnowledgeUsed(
  value: unknown,
  allowedKnowledge: KnowledgeUsed[],
) {
  if (!Array.isArray(value)) {
    return allowedKnowledge;
  }

  const allowed = new Map(
    allowedKnowledge.map((item) => [
      `${item.title}::${item.category}`.toLowerCase(),
      item,
    ]),
  );
  const normalized: KnowledgeUsed[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const title =
      "title" in item && typeof item.title === "string"
        ? item.title.trim()
        : "";
    const category =
      "category" in item && typeof item.category === "string"
        ? item.category.trim()
        : "";
    const allowedItem = allowed.get(`${title}::${category}`.toLowerCase());

    if (
      allowedItem &&
      !normalized.some(
        (existing) =>
          existing.title === allowedItem.title &&
          existing.category === allowedItem.category,
      )
    ) {
      normalized.push(allowedItem);
    }
  }

  return normalized;
}

function normalizePreAnalysis(
  modelOutput: Partial<AgronomicPreAnalysis>,
  fallback: AgronomicPreAnalysis,
  allowedKnowledge: KnowledgeUsed[] = [],
): AgronomicPreAnalysis {
  const riskLevel = normalizeRiskLevel(
    modelOutput.riskLevel,
    fallback.riskLevel,
  );

  return {
    initialDiagnosis: normalizeSafeText(
      modelOutput.initialDiagnosis,
      fallback.initialDiagnosis,
    ),
    probableHypotheses: normalizeStringArray(
      modelOutput.probableHypotheses,
      fallback.probableHypotheses,
    ),
    detailedHypotheses: Array.isArray(modelOutput.detailedHypotheses) && modelOutput.detailedHypotheses.length ? modelOutput.detailedHypotheses : fallback.detailedHypotheses,
    visualFindings: normalizeStringArray(modelOutput.visualFindings, fallback.visualFindings),
    possibleCauses: normalizeStringArray(modelOutput.possibleCauses, fallback.possibleCauses),
    missingQuestions: normalizeStringArray(
      modelOutput.missingQuestions,
      fallback.missingQuestions,
    ),
    riskLevel,
    confidenceLevel: normalizeRiskLevel(modelOutput.confidenceLevel, fallback.confidenceLevel),
    productionImpact: normalizeSafeText(modelOutput.productionImpact, fallback.productionImpact),
    attentionPoints: normalizeStringArray(modelOutput.attentionPoints, fallback.attentionPoints),
    initialRecommendation:
      typeof modelOutput.initialRecommendation === "string" &&
      modelOutput.initialRecommendation.trim()
        ? sanitizeAiSafetyText(modelOutput.initialRecommendation)
        : fallback.initialRecommendation,
    safeInitialRecommendations: normalizeStringArray(
      modelOutput.safeInitialRecommendations,
      fallback.safeInitialRecommendations,
    ),
    whenToCallHumanSpecialist:
      typeof modelOutput.whenToCallHumanSpecialist === "string" &&
      modelOutput.whenToCallHumanSpecialist.trim()
        ? sanitizeAiSafetyText(modelOutput.whenToCallHumanSpecialist)
        : fallback.whenToCallHumanSpecialist,
    humanReviewReason: normalizeSafeText(modelOutput.humanReviewReason, fallback.humanReviewReason),
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    knowledgeUsed: normalizeKnowledgeUsed(
      modelOutput.knowledgeUsed,
      allowedKnowledge,
    ),
    conversationalAnswer: fallback.conversationalAnswer
      ? sanitizeAiSafetyText(fallback.conversationalAnswer)
      : undefined,
  };
}

export async function generateAgronomicPreAnalysis(
  caseData: AgronomicCase,
  question?: string,
  _token?: string,
): Promise<AgronomicPreAnalysis> {
  const cropContext =
    caseData.crop_context ??
    (_token ? await fetchCropContext(caseData.crop, _token) : null);

  return analyzeAgronomicCase(
    { ...caseData, crop_context: cropContext },
    {
      question,
      userId: caseData.user_id,
      enableKnowledgeSearch: true,
      logUsage: true,
    },
  );
}

export async function updateAgronomicCaseWithAnalysis(
  caseId: string,
  token: string,
  analysis: AgronomicPreAnalysis,
) {
  const config = getSupabaseConfig();
  const serverCredentials = getSupabaseServerCredentials(token, config);
  const encodedCaseId = encodeURIComponent(caseId);

  const currentRows = await supabaseRequest<Array<{ status: string | null; human_review_requested: boolean | null; human_review_status: string | null }>>(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&select=status,human_review_requested,human_review_status&limit=1`,
    { method: "GET" },
    serverCredentials.token,
    serverCredentials.config,
  ).catch(() => []);
  const currentCase = currentRows[0];
  const keepHumanReviewStatus = Boolean(currentCase?.human_review_requested) || [
    "waiting_payment_human_review",
    "waiting_human_review",
    "human_reviewed",
    "completed",
    "cancelled",
  ].includes(currentCase?.status ?? "");

  await supabaseRequest(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ai_summary: analysis.initialDiagnosis,
        ai_recommendation: analysis.initialRecommendation,
        ai_analysis_json: analysis,
        risk_level: analysis.riskLevel,
        status: keepHumanReviewStatus ? currentCase?.status ?? "ai_analyzed" : "ai_analyzed",
      }),
    },
    serverCredentials.token,
    serverCredentials.config,
  );
}

export async function insertCaseChatMessage(
  input: {
    caseId: string;
    userId: string;
    role: "user" | "assistant";
    message: string;
    messageType?: CaseChatMessageType;
    fileUrl?: string | null;
  },
  token: string,
) {
  const rows = await supabaseRequest<AgronomicCaseChatMessage[]>(
    "/rest/v1/case_chat_messages?select=id,case_id,user_id,role,message,message_type,file_url,created_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        case_id: input.caseId,
        user_id: input.userId,
        role: input.role,
        message: input.message,
        message_type: input.messageType ?? "text",
        file_url: input.fileUrl ?? null,
      }),
    },
    token,
  );

  return rows[0] ?? null;
}

export async function fetchCaseChatMessages(caseId: string, token: string) {
  return supabaseRequest<AgronomicCaseChatMessage[]>(
    `/rest/v1/case_chat_messages?case_id=eq.${encodeURIComponent(caseId)}&select=id,case_id,user_id,role,message,message_type,file_url,created_at&order=created_at.asc`,
    { method: "GET" },
    token,
  );
}

export async function fetchCasePendingQuestions(caseId: string, token: string) {
  return supabaseRequest<CasePendingQuestion[]>(
    `/rest/v1/case_pending_questions?case_id=eq.${encodeURIComponent(caseId)}&select=id,case_id,question,answer,status,order_index,created_at,answered_at&order=order_index.asc`,
    { method: "GET" },
    token,
  );
}

export async function replaceCasePendingQuestions(
  caseId: string,
  questions: string[],
  token: string,
) {
  await supabaseRequest(
    `/rest/v1/case_pending_questions?case_id=eq.${encodeURIComponent(caseId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
    token,
  );

  const rows = questions
    .map((question, index) => ({
      case_id: caseId,
      question: question.trim(),
      status: "pending",
      order_index: index,
    }))
    .filter((row) => row.question.length > 0);

  if (rows.length === 0) {
    return [];
  }

  return supabaseRequest<CasePendingQuestion[]>(
    "/rest/v1/case_pending_questions?select=id,case_id,question,answer,status,order_index,created_at,answered_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    },
    token,
  );
}


export function getPendingQuestionTexts(questions: CasePendingQuestion[]) {
  return questions
    .filter((question) => question.status === "pending")
    .sort((a, b) => a.order_index - b.order_index)
    .map((question) => question.question);
}

export function syncAnalysisMissingQuestionsWithPendingQueue(
  analysis: AgronomicPreAnalysis,
  questions: CasePendingQuestion[],
): AgronomicPreAnalysis {
  return {
    ...analysis,
    missingQuestions: getPendingQuestionTexts(questions),
  };
}

export function logPendingQuestionSync(input: {
  scope: string;
  aiMissingQuestions?: string[];
  questions: CasePendingQuestion[];
}) {
  const pending = getPendingQuestionTexts(input.questions);
  const answered = input.questions
    .filter((question) => question.status === "answered")
    .sort((a, b) => a.order_index - b.order_index)
    .map((question) => ({
      id: question.id,
      question: question.question,
      hasAnswer: Boolean(question.answer?.trim()),
    }));

  console.info("[agronomic-pending-questions-sync]", {
    scope: input.scope,
    pendingCount: pending.length,
    answeredCount: answered.length,
    pendingQuestions: pending,
    answeredQuestions: answered,
    aiMissingQuestions: input.aiMissingQuestions ?? [],
    dbMissingQuestions: pending,
  });
}

export function getCurrentPendingQuestion(questions: CasePendingQuestion[]) {
  return (
    questions
      .filter((question) => question.status === "pending")
      .sort((a, b) => a.order_index - b.order_index)[0] ?? null
  );
}

export async function answerCurrentPendingQuestion(
  caseId: string,
  answer: string,
  token: string,
) {
  const questions = await fetchCasePendingQuestions(caseId, token);
  const currentQuestion = getCurrentPendingQuestion(questions);

  if (!currentQuestion) {
    return { answered: null, next: null, questions };
  }

  const rows = await supabaseRequest<CasePendingQuestion[]>(
    `/rest/v1/case_pending_questions?id=eq.${encodeURIComponent(currentQuestion.id)}&select=id,case_id,question,answer,status,order_index,created_at,answered_at`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        answer,
        status: "answered",
        answered_at: new Date().toISOString(),
      }),
    },
    token,
  );

  const updatedQuestions = questions.map((question) =>
    question.id === currentQuestion.id ? (rows[0] ?? question) : question,
  );
  const next = getCurrentPendingQuestion(updatedQuestions);

  return {
    answered: rows[0] ?? currentQuestion,
    next,
    questions: updatedQuestions,
  };
}

export { fetchCropContext, summarizeCropContext };

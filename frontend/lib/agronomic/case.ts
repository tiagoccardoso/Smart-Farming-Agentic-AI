import { analyzeAgronomicCase } from "../../src/lib/ai/orchestrator/analyze-case";
import { areEmbeddingsConfigured, generateEmbeddingIfConfigured } from "../ai/embeddings";
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
  human_review_requested: boolean;
  human_review_status: string | null;
  created_at: string | null;
  farm_id: string | null;
  farm: AgronomicFarm | null;
  images: AgronomicCaseImage[];
  question_history?: AgronomicQuestionHistory[];
};

export type AgronomicRiskLevel = "low" | "medium" | "high";

export type KnowledgeUsed = {
  title: string;
  category: string;
};

export type AgronomicPreAnalysis = {
  initialDiagnosis: string;
  probableHypotheses: string[];
  missingQuestions: string[];
  riskLevel: AgronomicRiskLevel;
  initialRecommendation: string;
  whenToCallHumanSpecialist: string;
  disclaimer: string;
  knowledgeUsed: KnowledgeUsed[];
  conversationalAnswer?: string;
};

type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
};

type CaseRow = Omit<AgronomicCase, "farm" | "images" | "question_history">;

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
const KNOWLEDGE_CATEGORY_PRIORITY = ["protocolo", "recomendacao", "manejo", "pragas", "doencas", "solo"];
const KNOWLEDGE_CONTEXT_MAX_CHARS = 6000;
const KNOWLEDGE_ITEM_MAX_CHARS = 1200;
const KNOWLEDGE_MAX_ITEMS = 6;

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

function getSupabaseServerCredentials(fallbackToken: string, config = getSupabaseConfig()) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return { token: fallbackToken, config };
  }

  return { token: serviceRoleKey, config: { ...config, anonKey: serviceRoleKey } };
}

function normalizeForSearch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sanitizeKnowledgeContent(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptKnowledgeContent(content: string) {
  return content.length > KNOWLEDGE_ITEM_MAX_CHARS ? `${content.slice(0, KNOWLEDGE_ITEM_MAX_CHARS).trim()}...` : content;
}

function getCaseSearchTerms(caseData: AgronomicCase, question?: string) {
  const text = normalizeForSearch(`${caseData.crop} ${caseData.growth_stage ?? ""} ${caseData.symptoms} ${caseData.history ?? ""} ${question ?? ""}`);

  return Array.from(new Set(text.match(/[a-z0-9]{4,}/g) ?? [])).slice(0, 40);
}

function rankKnowledgeMaterial(material: SpecialistKnowledgeMaterial, caseData: AgronomicCase, terms: string[]) {
  const category = normalizeForSearch(material.category);
  const crop = normalizeForSearch(material.crop);
  const caseCrop = normalizeForSearch(caseData.crop);
  const searchable = normalizeForSearch(`${material.title ?? ""} ${material.category ?? ""} ${material.crop ?? ""} ${material.content ?? ""}`);
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
  return value.replace(/[(),*]/g, " ").replace(/\s+/g, " ").trim();
}


function buildCaseEmbeddingText(caseData: AgronomicCase, question?: string) {
  return [
    `Cultura: ${caseData.crop || "não informada"}`,
    caseData.growth_stage ? `Estádio: ${caseData.growth_stage}` : null,
    caseData.symptoms ? `Sintomas: ${caseData.symptoms}` : null,
    caseData.history ? `Histórico de manejo: ${caseData.history}` : null,
    caseData.farm?.soil_type ? `Tipo de solo: ${caseData.farm.soil_type}` : null,
    caseData.farm?.city || caseData.farm?.state ? `Localização: ${[caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/")}` : null,
    question?.trim() ? `Pergunta complementar: ${question.trim()}` : null
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
    .filter((material) => material.title?.trim() && sanitizeKnowledgeContent(material.content).length > 0)
    .map((material) => ({
      ...material,
      relevanceScore: typeof material.similarity === "number" ? material.similarity : 0,
      excerpt: excerptKnowledgeContent(sanitizeKnowledgeContent(material.content))
    }))
    .filter((material) => material.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const material of ranked) {
    if (selected.length >= KNOWLEDGE_MAX_ITEMS) {
      break;
    }

    const entrySize = material.excerpt.length + (material.title?.length ?? 0) + (material.category?.length ?? 0) + 120;

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
    "limit=80"
  ];
  const crop = sanitizePostgrestPattern(caseData.crop ?? "");

  if (crop) {
    filters.push(`or=${encodeURIComponent(`(crop.ilike.*${crop}*,crop.is.null,crop.eq.)`)}`);
  } else {
    filters.push(`or=${encodeURIComponent("(crop.is.null,crop.eq.)")}`);
  }

  return `/rest/v1/specialist_knowledge?${filters.join("&")}`;
}

function selectRelevantKnowledge(materials: SpecialistKnowledgeMaterial[], caseData: AgronomicCase, question?: string) {
  const terms = getCaseSearchTerms(caseData, question);
  let usedChars = 0;
  const selected: RankedKnowledgeMaterial[] = [];

  const ranked = materials
    .filter((material) => material.active !== false && material.title?.trim() && sanitizeKnowledgeContent(material.content).length > 0)
    .map((material) => ({
      ...material,
      relevanceScore: rankKnowledgeMaterial(material, caseData, terms),
      excerpt: excerptKnowledgeContent(sanitizeKnowledgeContent(material.content))
    }))
    .filter((material) => material.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  for (const material of ranked) {
    if (selected.length >= KNOWLEDGE_MAX_ITEMS) {
      break;
    }

    const entrySize = material.excerpt.length + (material.title?.length ?? 0) + (material.category?.length ?? 0) + 120;

    if (usedChars + entrySize > KNOWLEDGE_CONTEXT_MAX_CHARS) {
      continue;
    }

    selected.push(material);
    usedChars += entrySize;
  }

  return selected;
}

async function fetchSemanticSpecialistKnowledge(caseData: AgronomicCase, token: string, question?: string) {
  if (!areEmbeddingsConfigured()) {
    return null;
  }

  const embedding = await generateEmbeddingIfConfigured(buildCaseEmbeddingText(caseData, question));

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
        crop_filter: caseData.crop || null
      })
    },
    serverCredentials.token,
    serverCredentials.config
  );

  return prepareSemanticKnowledge(Array.isArray(materials) ? materials : []);
}

async function fetchFallbackSpecialistKnowledge(caseData: AgronomicCase, token: string, question?: string) {
  const config = getSupabaseConfig();
  const serverCredentials = getSupabaseServerCredentials(token, config);
  const materials = await supabaseRequest<SpecialistKnowledgeMaterial[]>(
    buildKnowledgeSelectPath(caseData),
    { method: "GET" },
    serverCredentials.token,
    serverCredentials.config
  );

  return selectRelevantKnowledge(Array.isArray(materials) ? materials : [], caseData, question);
}

export async function fetchRelevantSpecialistKnowledge(caseData: AgronomicCase, token: string, question?: string) {
  try {
    const semanticMaterials = await fetchSemanticSpecialistKnowledge(caseData, token, question);

    if (semanticMaterials) {
      return semanticMaterials;
    }
  } catch (error) {
    console.warn("Não foi possível usar embeddings para consultar specialist_knowledge; usando busca simples.", error);
  }

  try {
    return await fetchFallbackSpecialistKnowledge(caseData, token, question);
  } catch (error) {
    console.warn("Não foi possível carregar a base specialist_knowledge para a análise agronômica.", error);
    return [];
  }
}

function mapKnowledgeUsed(materials: Array<Pick<SpecialistKnowledgeMaterial, "title" | "category">>): KnowledgeUsed[] {
  return materials
    .filter((material) => material.title?.trim() && material.category?.trim())
    .map((material) => ({ title: material.title!.trim(), category: material.category!.trim() }));
}

export async function fetchAgronomicCase(caseId: string, token: string) {
  const config = getSupabaseConfig();
  const encodedCaseId = encodeURIComponent(caseId);
  const cases = await supabaseRequest<CaseRow[]>(
    `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&select=id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,human_review_requested,human_review_status,created_at,farm_id&limit=1`,
    { method: "GET" },
    token,
    config
  );

  const agronomicCase = cases[0];

  if (!agronomicCase) {
    return null;
  }

  const [farms, images, questionHistory] = await Promise.all([
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
    ),
    supabaseRequest<AgronomicQuestionHistory[]>(
      `/rest/v1/ai_question_history?case_id=eq.${encodedCaseId}&select=id,case_id,question,answer,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
      config
    )
  ]);

  return {
    ...agronomicCase,
    farm: farms[0] ?? null,
    images,
    question_history: questionHistory
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
    knowledgeUsed: [],
    conversationalAnswer: questionText
      ? `Sobre sua pergunta (“${questionText}”): responda primeiro às perguntas faltantes e compare o padrão no talhão. A orientação continua inicial; decisões de aplicação, dose ou intervenção devem ser revisadas por especialista.`
      : undefined
  };
}

function buildAgronomicPrompt(caseData: AgronomicCase, question?: string, specialistKnowledge: RankedKnowledgeMaterial[] = []) {
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "não informada";
  const farmName = caseData.farm?.name || "não informada";
  const area = caseData.farm?.area_hectares ? `${caseData.farm.area_hectares} ha` : "não informada";
  const soilType = caseData.farm?.soil_type || "não informado";
  const images = caseData.images.length
    ? caseData.images.map((image, index) => `${index + 1}. ${image.image_url} (${image.image_type ?? "tipo não informado"})`).join("\n")
    : "Nenhuma imagem anexada.";
  const optionalQuestion = question?.trim() ? `\nPergunta complementar do usuário: ${question.trim()}` : "";
  const knowledgeContext = specialistKnowledge.length
    ? specialistKnowledge
        .map((material, index) =>
          [
            `${index + 1}. Título: ${material.title}`,
            `Categoria: ${material.category}`,
            `Cultura: ${material.crop?.trim() || "geral / sem cultura específica"}`,
            `Conteúdo: ${material.excerpt}`
          ].join("\n")
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
- Use a base specialist_knowledge apenas quando ela for relevante para o caso.
- Não invente fontes: preencha knowledgeUsed somente com títulos e categorias listados em "Fontes permitidas em knowledgeUsed".
- Se nenhuma fonte da base specialist_knowledge foi fornecida ou usada, retorne knowledgeUsed como array vazio.
- Classifique riskLevel somente como "low", "medium" ou "high".
- Use "low" para sintomas leves, informação suficiente e baixo impacto imediato.
- Use "medium" para incerteza relevante ou possibilidade de perda.
- Use "high" para risco de perda econômica, praga/doença agressiva, sintomas severos ou falta de dados críticos.

Formato obrigatório:
{
  "initialDiagnosis": "",
  "probableHypotheses": [],
  "missingQuestions": [],
  "riskLevel": "low | medium | high",
  "initialRecommendation": "",
  "whenToCallHumanSpecialist": "",
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

function sanitizeAiSafetyText(value: string) {
  const exactDosagePattern = /\b\d+(?:[,.]\d+)?\s*(?:m\s*l|ml|l|litros?|g|gramas?|kg|quilos?)\s*(?:\/|por)\s*(?:ha|hectare|hectares|planta|plantas|litro|litros|l)\b/gi;
  const sanitized = value.replace(exactDosagePattern, EXACT_PESTICIDE_DOSAGE_WARNING);

  if (sanitized !== value && !sanitized.includes(EXACT_PESTICIDE_DOSAGE_WARNING)) {
    return `${sanitized.trim()} ${EXACT_PESTICIDE_DOSAGE_WARNING}`.trim();
  }

  return sanitized.trim();
}

function normalizeSafeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? sanitizeAiSafetyText(value) : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => sanitizeAiSafetyText(item));
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRiskLevel(value: unknown, fallback: AgronomicRiskLevel): AgronomicRiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function normalizeKnowledgeUsed(value: unknown, allowedKnowledge: KnowledgeUsed[]) {
  if (!Array.isArray(value)) {
    return allowedKnowledge;
  }

  const allowed = new Map(allowedKnowledge.map((item) => [`${item.title}::${item.category}`.toLowerCase(), item]));
  const normalized: KnowledgeUsed[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const title = "title" in item && typeof item.title === "string" ? item.title.trim() : "";
    const category = "category" in item && typeof item.category === "string" ? item.category.trim() : "";
    const allowedItem = allowed.get(`${title}::${category}`.toLowerCase());

    if (allowedItem && !normalized.some((existing) => existing.title === allowedItem.title && existing.category === allowedItem.category)) {
      normalized.push(allowedItem);
    }
  }

  return normalized;
}

function normalizePreAnalysis(
  modelOutput: Partial<AgronomicPreAnalysis>,
  fallback: AgronomicPreAnalysis,
  allowedKnowledge: KnowledgeUsed[] = []
): AgronomicPreAnalysis {
  const riskLevel = normalizeRiskLevel(modelOutput.riskLevel, fallback.riskLevel);

  return {
    initialDiagnosis: normalizeSafeText(modelOutput.initialDiagnosis, fallback.initialDiagnosis),
    probableHypotheses: normalizeStringArray(modelOutput.probableHypotheses, fallback.probableHypotheses),
    missingQuestions: normalizeStringArray(modelOutput.missingQuestions, fallback.missingQuestions),
    riskLevel,
    initialRecommendation:
      typeof modelOutput.initialRecommendation === "string" && modelOutput.initialRecommendation.trim()
        ? sanitizeAiSafetyText(modelOutput.initialRecommendation)
        : fallback.initialRecommendation,
    whenToCallHumanSpecialist:
      typeof modelOutput.whenToCallHumanSpecialist === "string" && modelOutput.whenToCallHumanSpecialist.trim()
        ? sanitizeAiSafetyText(modelOutput.whenToCallHumanSpecialist)
        : fallback.whenToCallHumanSpecialist,
    disclaimer: AGRONOMIC_AI_DISCLAIMER,
    knowledgeUsed: normalizeKnowledgeUsed(modelOutput.knowledgeUsed, allowedKnowledge),
    conversationalAnswer: fallback.conversationalAnswer ? sanitizeAiSafetyText(fallback.conversationalAnswer) : undefined
  };
}

export async function generateAgronomicPreAnalysis(caseData: AgronomicCase, question?: string, _token?: string): Promise<AgronomicPreAnalysis> {
  return analyzeAgronomicCase(caseData, {
    question,
    userId: caseData.user_id,
    enableKnowledgeSearch: true,
    logUsage: true
  });
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

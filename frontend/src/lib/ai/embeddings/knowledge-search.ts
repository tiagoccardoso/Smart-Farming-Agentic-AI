import { generateOpenAIEmbedding } from "./openai-embeddings";
import type { KnowledgeDocument } from "../providers/types";

type SearchCase = {
  crop?: string | null;
  growth_stage?: string | null;
  symptoms?: string | null;
  history?: string | null;
  soil_analysis_url?: string | null;
  farm?: { soil_type?: string | null; city?: string | null; state?: string | null } | null;
};

type SpecialistKnowledgeRow = {
  id?: string;
  title?: string | null;
  category?: string | null;
  crop?: string | null;
  content?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  similarity?: number | null;
};

const PRIORITY = ["protocolo", "doencas", "doenças", "pragas", "manejo", "solo", "recomendacoes", "recomendações"];
const MAX_ITEMS = 8;
const MAX_CONTENT = 2400;

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), key: serviceRoleKey || anonKey };
}

async function supabaseRest<T>(path: string, init: RequestInit = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    cache: "no-store"
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Falha ao consultar specialist_knowledge.");
  }

  return payload as T;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function excerpt(value: string | null | undefined) {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_CONTENT ? `${clean.slice(0, MAX_CONTENT).trim()}...` : clean;
}

function buildCaseText(caseData: SearchCase, question?: string) {
  return [
    `Cultura: ${caseData.crop || "não informada"}`,
    caseData.growth_stage ? `Estádio: ${caseData.growth_stage}` : null,
    caseData.symptoms ? `Sintomas: ${caseData.symptoms}` : null,
    caseData.history ? `Histórico: ${caseData.history}` : null,
    caseData.farm?.soil_type ? `Solo: ${caseData.farm.soil_type}` : null,
    question?.trim() ? `Pergunta: ${question.trim()}` : null
  ].filter(Boolean).join("\n");
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function rank(row: SpecialistKnowledgeRow, caseData: SearchCase, terms: string[]) {
  const category = normalizeText(row.category);
  const crop = normalizeText(row.crop);
  const caseCrop = normalizeText(caseData.crop);
  const searchable = normalizeText(`${row.title ?? ""} ${row.category ?? ""} ${row.crop ?? ""} ${row.content ?? ""}`);
  let score = typeof row.similarity === "number" ? row.similarity * 100 : 0;

  const priorityIndex = PRIORITY.indexOf(category);
  if (priorityIndex >= 0) {
    score += (PRIORITY.length - priorityIndex) * 8;
  }

  if (caseCrop && crop.includes(caseCrop)) {
    score += 30;
  } else if (!crop) {
    score += 8;
  }

  for (const term of terms) {
    if (searchable.includes(term)) {
      score += 2;
    }
  }

  return score;
}

function toKnowledgeDocument(row: SpecialistKnowledgeRow): KnowledgeDocument | null {
  const title = row.title?.trim();
  const category = row.category?.trim();
  const content = excerpt(row.content);

  if (!title || !category || !content) {
    return null;
  }

  return { id: row.id, title, category, crop: row.crop, content, similarity: row.similarity };
}

async function semanticSearch(caseData: SearchCase, question?: string) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const embedding = await generateOpenAIEmbedding(buildCaseText(caseData, question));
  return supabaseRest<SpecialistKnowledgeRow[]>("/rest/v1/rpc/match_specialist_knowledge", {
    method: "POST",
    body: JSON.stringify({ query_embedding: vectorLiteral(embedding), match_count: MAX_ITEMS, crop_filter: caseData.crop || null })
  });
}

async function lexicalSearch(caseData: SearchCase) {
  const crop = (caseData.crop ?? "").replace(/[(),*]/g, " ").trim();
  const cropFilter = crop ? `or=${encodeURIComponent(`(crop.ilike.*${crop}*,crop.is.null,crop.eq.)`)}` : `or=${encodeURIComponent("(crop.is.null,crop.eq.)")}`;
  return supabaseRest<SpecialistKnowledgeRow[]>(`/rest/v1/specialist_knowledge?select=id,title,category,crop,content,active,created_at&active=eq.true&order=created_at.desc&limit=80&${cropFilter}`, { method: "GET" });
}

export async function searchSpecialistKnowledge(caseData: SearchCase, question?: string): Promise<KnowledgeDocument[]> {
  const terms = normalizeText(`${caseData.crop ?? ""} ${caseData.symptoms ?? ""} ${caseData.history ?? ""} ${question ?? ""}`).match(/[a-z0-9]{4,}/g) ?? [];
  let rows: SpecialistKnowledgeRow[] | null = null;

  try {
    rows = await semanticSearch(caseData, question);
  } catch (error) {
    console.warn("Busca semântica em specialist_knowledge indisponível; usando busca textual.", error);
  }

  if (!rows) {
    try {
      rows = await lexicalSearch(caseData);
    } catch (error) {
      console.warn("Busca textual em specialist_knowledge indisponível.", error);
      rows = [];
    }
  }

  return (rows ?? [])
    .filter((row) => row.active !== false)
    .map((row) => ({ row, score: rank(row, caseData, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .map(({ row }) => toKnowledgeDocument(row))
    .filter((item): item is KnowledgeDocument => Boolean(item));
}

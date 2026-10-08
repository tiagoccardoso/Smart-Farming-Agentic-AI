/**
 * Organiza a análise da IA em seções retráteis, sem alterar o conteúdo técnico.
 *
 * - Funciona com análises estruturadas novas e antigas (campos ausentes) e com
 *   casos legados que só têm ai_summary/ai_recommendation em texto.
 * - Seções sem conteúdo não são exibidas.
 * - URLs no corpo viram referências numeradas [n]; todas as fontes ficam na
 *   seção "Fontes e referências". Nenhuma fonte é criada: só entram URLs que
 *   vieram da própria resposta ou da pesquisa/base usada.
 */

import { normalizeAiResponseText } from "./ai-response-formatting";

type Level = "low" | "medium" | "high";

export type AnalysisLike = {
  popularSummary?: string | null;
  technicalDetails?: string | null;
  initialDiagnosis?: string | null;
  probableHypotheses?: string[] | null;
  detailedHypotheses?: Array<{
    name: string;
    probability?: Level | string | null;
    justification?: string | null;
    favorableFactors?: string[] | null;
    uncertaintyFactors?: string[] | null;
    potentialImpact?: string | null;
  }> | null;
  visualFindings?: string[] | null;
  possibleCauses?: string[] | null;
  missingQuestions?: string[] | null;
  riskLevel?: Level | string | null;
  confidenceLevel?: Level | string | null;
  productionImpact?: string | null;
  attentionPoints?: string[] | null;
  initialRecommendation?: string | null;
  safeInitialRecommendations?: string[] | null;
  whenToCallHumanSpecialist?: string | null;
  humanReviewReason?: string | null;
  disclaimer?: string | null;
  knowledgeUsed?: Array<{ title: string; category?: string | null }> | null;
  internetResearch?: {
    status?: string | null;
    query?: string | null;
    summary?: string | null;
    sources?: Array<{ title?: string | null; url?: string | null; snippet?: string | null }> | null;
  } | null;
  sourceMetadata?: {
    searchSucceeded?: boolean;
    internalKnowledgeUsed?: boolean;
    modelFallbackUsed?: boolean;
    sources?: Array<{ title?: string | null; url?: string | null }> | null;
  } | null;
  preventiveCare?: string[] | null;
  nextSteps?: string[] | null;
  analyzedAt?: string | null;
};

export type AnalysisReference = {
  index: number;
  title: string;
  url: string | null;
  origin: "internet" | "internal" | "response";
  detail: string | null;
};

export type HypothesisBlockItem = {
  name: string;
  probabilityLabel: string | null;
  probability: Level | null;
  justification: string | null;
  favorableFactors: string[];
  uncertaintyFactors: string[];
  potentialImpact: string | null;
};

export type SectionBlock =
  | { type: "text"; text: string; label?: string }
  | { type: "list"; label?: string; items: string[]; tone?: "neutral" | "positive" | "warning" }
  | { type: "hypotheses"; items: HypothesisBlockItem[] }
  | { type: "facts"; items: Array<{ label: string; value: string; tone?: Level | "neutral" }> }
  | { type: "note"; text: string; tone: "info" | "warning" | "neutral" }
  | { type: "references"; items: AnalysisReference[] };

export type AnalysisSectionId =
  | "summary"
  | "symptoms"
  | "causes"
  | "technical"
  | "management"
  | "prevention"
  | "next-steps"
  | "sources";

export type AnalysisSection = {
  id: AnalysisSectionId;
  title: string;
  defaultOpen: boolean;
  blocks: SectionBlock[];
  /** Quantidade de itens principais (exibida no cabeçalho da seção). */
  count?: number;
};

export const LEVEL_LABELS: Record<Level, string> = { low: "Baixo", medium: "Médio", high: "Alto" };
const PROBABILITY_LABELS: Record<Level, string> = { low: "Probabilidade baixa", medium: "Probabilidade média", high: "Probabilidade alta" };
const CONFIDENCE_LABELS: Record<Level, string> = { low: "Baixa", medium: "Média", high: "Alta" };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

function asLevel(value: unknown): Level | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return normalizeAiResponseText(value).trim();
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value) {
    const text = cleanText(raw);
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      items.push(text);
    }
  }
  return items;
}

export function normalizeReferenceUrl(url: string) {
  return url.replace(/[.,;:!?]+$/, "").replace(/\/$/, "");
}

/**
 * Registro de referências compartilhado entre as seções: a mesma URL sempre
 * recebe o mesmo número.
 */
export class ReferenceRegistry {
  private items: AnalysisReference[] = [];

  add(input: { title?: string | null; url?: string | null; origin: AnalysisReference["origin"]; detail?: string | null }) {
    const url = input.url ? normalizeReferenceUrl(input.url.trim()) : null;
    const title = cleanText(input.title) || (url ? url.replace(/^https?:\/\//, "").split("/")[0] : "");
    if (!title && !url) return null;
    const existing = this.items.find((item) =>
      url ? item.url === url : !item.url && item.title.toLowerCase() === title.toLowerCase(),
    );
    if (existing) {
      if (existing.origin === "response" && input.origin !== "response") {
        existing.origin = input.origin;
        if (input.title) existing.title = title;
      }
      return existing;
    }
    const reference: AnalysisReference = {
      index: this.items.length + 1,
      title,
      url,
      origin: input.origin,
      detail: cleanText(input.detail) || null,
    };
    this.items.push(reference);
    return reference;
  }

  /** Substitui URLs do texto por [n], registrando-as como referência. */
  linkify(text: string) {
    if (!text) return text;
    return text
      .replace(URL_PATTERN, (match) => {
        const reference = this.add({ url: match, origin: "response" });
        return reference ? `[${reference.index}]` : "";
      })
      .replace(/\(\s*(\[\d+\])\s*\)/g, " $1")
      .replace(/[ \t]+\[/g, " [")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  list() {
    return [...this.items];
  }
}

function textBlock(registry: ReferenceRegistry, value: unknown, label?: string): SectionBlock | null {
  const text = registry.linkify(cleanText(value));
  return text ? { type: "text", text, ...(label ? { label } : {}) } : null;
}

function listBlock(
  registry: ReferenceRegistry,
  value: unknown,
  label?: string,
  tone?: "neutral" | "positive" | "warning",
): SectionBlock | null {
  const items = cleanList(value).map((item) => registry.linkify(item)).filter(Boolean);
  return items.length ? { type: "list", items, ...(label ? { label } : {}), ...(tone ? { tone } : {}) } : null;
}

function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter(Boolean) as T[];
}

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

export type BuildAnalysisSectionsInput = {
  analysis: AnalysisLike | null | undefined;
  /** Texto relatado pelo produtor no cadastro do caso. */
  reportedSymptoms?: string | null;
  /** Perguntas pendentes oficiais do caso (fila do banco). */
  pendingQuestions?: string[];
  /** Casos antigos: resumo e recomendação em texto livre. */
  legacySummary?: string | null;
  legacyRecommendation?: string | null;
  legacyRiskLevel?: string | null;
};

export function buildAnalysisSections(input: BuildAnalysisSectionsInput) {
  const analysis = input.analysis ?? null;
  const registry = new ReferenceRegistry();

  // Fontes reais primeiro, para que as citações [n] sigam a ordem da pesquisa.
  const internetSucceeded = analysis?.internetResearch?.status === "success" || analysis?.sourceMetadata?.searchSucceeded === true;
  if (internetSucceeded) {
    for (const source of analysis?.internetResearch?.sources ?? []) {
      registry.add({ title: source.title, url: source.url, origin: "internet", detail: source.snippet });
    }
    for (const source of analysis?.sourceMetadata?.sources ?? []) {
      registry.add({ title: source.title, url: source.url, origin: "internet" });
    }
  }
  for (const item of analysis?.knowledgeUsed ?? []) {
    registry.add({ title: item.title, origin: "internal", detail: item.category ? `Base técnica interna · ${item.category}` : "Base técnica interna" });
  }

  const risk = asLevel(analysis?.riskLevel) ?? asLevel(input.legacyRiskLevel);
  const confidence = asLevel(analysis?.confidenceLevel);
  const analyzedAtLabel = formatDateTime(analysis?.analyzedAt);

  const summaryText = cleanText(analysis?.popularSummary) || cleanText(analysis?.initialDiagnosis) || cleanText(input.legacySummary);
  const summary: AnalysisSection = {
    id: "summary",
    title: "Resumo da análise",
    defaultOpen: true,
    blocks: compact<SectionBlock>([
      risk || confidence || analyzedAtLabel
        ? {
            type: "facts",
            items: compact([
              risk ? { label: "Nível de risco", value: LEVEL_LABELS[risk], tone: risk } : null,
              confidence ? { label: "Confiança da IA", value: CONFIDENCE_LABELS[confidence], tone: "neutral" as const } : null,
              analyzedAtLabel ? { label: "Gerada em", value: analyzedAtLabel, tone: "neutral" as const } : null,
            ]),
          }
        : null,
      textBlock(registry, summaryText),
    ]),
  };

  const symptoms: AnalysisSection = {
    id: "symptoms",
    title: "Sintomas identificados",
    defaultOpen: false,
    blocks: compact([
      textBlock(registry, input.reportedSymptoms, "Relato do produtor"),
      listBlock(registry, analysis?.visualFindings, "Sinais observados nas imagens e no relato"),
    ]),
  };

  const hypotheses: HypothesisBlockItem[] = (analysis?.detailedHypotheses ?? [])
    .filter((item) => cleanText(item?.name))
    .map((item) => {
      const probability = asLevel(item.probability);
      return {
        name: cleanText(item.name),
        probability,
        probabilityLabel: probability ? PROBABILITY_LABELS[probability] : null,
        justification: registry.linkify(cleanText(item.justification)) || null,
        favorableFactors: cleanList(item.favorableFactors).map((value) => registry.linkify(value)),
        uncertaintyFactors: cleanList(item.uncertaintyFactors).map((value) => registry.linkify(value)),
        potentialImpact: registry.linkify(cleanText(item.potentialImpact)) || null,
      };
    });
  const causes: AnalysisSection = {
    id: "causes",
    title: "Possíveis causas",
    defaultOpen: false,
    count: hypotheses.length || cleanList(analysis?.probableHypotheses).length || undefined,
    blocks: compact<SectionBlock>([
      hypotheses.length
        ? { type: "hypotheses", items: hypotheses }
        : listBlock(registry, analysis?.probableHypotheses, "Hipóteses levantadas"),
      listBlock(registry, analysis?.possibleCauses, "Fatores que podem estar envolvidos"),
      hypotheses.length || cleanList(analysis?.probableHypotheses).length
        ? { type: "note", tone: "neutral", text: "Hipóteses de triagem remota. A confirmação depende de inspeção em campo ou avaliação especializada." }
        : null,
    ]),
  };

  const technicalText = cleanText(analysis?.technicalDetails) || (analysis ? cleanText(analysis.initialDiagnosis) : "");
  const technical: AnalysisSection = {
    id: "technical",
    title: "Avaliação técnica",
    defaultOpen: false,
    blocks: compact([
      textBlock(registry, analysis?.productionImpact, "Impacto produtivo possível"),
      textBlock(registry, technicalText, analysis?.technicalDetails ? "Detalhamento técnico" : undefined),
    ]),
  };

  const recommendations = cleanList(analysis?.safeInitialRecommendations);
  const management: AnalysisSection = {
    id: "management",
    title: "Recomendações de manejo",
    defaultOpen: false,
    count: recommendations.length || undefined,
    blocks: compact<SectionBlock>([
      recommendations.length
        ? listBlock(registry, recommendations, undefined, "positive")
        : textBlock(registry, analysis?.initialRecommendation || input.legacyRecommendation),
      recommendations.length && cleanText(analysis?.initialRecommendation) && !recommendations.includes(cleanText(analysis?.initialRecommendation))
        ? textBlock(registry, analysis?.initialRecommendation, "Prioridade inicial")
        : null,
    ]),
  };

  const prevention: AnalysisSection = {
    id: "prevention",
    title: "Cuidados e prevenção",
    defaultOpen: false,
    blocks: compact<SectionBlock>([
      listBlock(registry, analysis?.preventiveCare, "Medidas preventivas", "positive"),
      listBlock(registry, analysis?.attentionPoints, "Pontos de atenção e riscos", "warning"),
      cleanText(analysis?.disclaimer) ? { type: "note", tone: "warning", text: cleanText(analysis?.disclaimer) } : null,
    ]),
  };
  // Só o aviso padrão não justifica uma seção.
  if (!prevention.blocks.some((block) => block.type !== "note")) prevention.blocks = [];

  const pending = (input.pendingQuestions?.length ? input.pendingQuestions : analysis?.missingQuestions) ?? [];
  const nextSteps: AnalysisSection = {
    id: "next-steps",
    title: "Próximos passos",
    defaultOpen: false,
    blocks: compact([
      listBlock(registry, analysis?.nextSteps, undefined, "neutral"),
      listBlock(registry, pending, "Informações que ajudariam a IA"),
      textBlock(registry, analysis?.whenToCallHumanSpecialist, "Quando procurar a especialista"),
    ]),
  };

  const references = registry.list();
  const research = analysis?.internetResearch;
  const sourcesNote = !analysis
    ? null
    : analysis.sourceMetadata?.modelFallbackUsed || (!internetSucceeded && !(analysis.knowledgeUsed ?? []).length)
      ? "Esta análise foi feita com os dados do caso e o conhecimento geral da IA. Não houve fonte externa ou interna aproveitada nesta execução."
      : internetSucceeded && (analysis.knowledgeUsed ?? []).length
        ? "A análise combinou pesquisa externa com materiais da base técnica interna."
        : internetSucceeded
          ? "A análise usou pesquisa externa. Nenhum material interno foi aplicado."
          : research && research.status !== "success"
            ? "A pesquisa externa não retornou conteúdo validado nesta execução; foram usados a base técnica interna e os dados do caso."
            : null;
  const sources: AnalysisSection = {
    id: "sources",
    title: "Fontes e referências",
    defaultOpen: false,
    count: references.length || undefined,
    blocks: compact<SectionBlock>([
      references.length ? { type: "references", items: references } : null,
      sourcesNote ? { type: "note", tone: "info", text: sourcesNote } : null,
    ]),
  };

  const sections = [summary, symptoms, causes, technical, management, prevention, nextSteps, sources].filter(
    (section) => section.blocks.length > 0,
  );

  return { sections, references };
}

/** Divide um texto com marcadores [n] em partes para renderização com links. */
export function splitReferenceMarkers(text: string, maxIndex: number) {
  const parts: Array<{ type: "text"; value: string } | { type: "ref"; index: number }> = [];
  const pattern = /\[(\d{1,3})\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const index = Number(match[1]);
    if (index < 1 || index > maxIndex) continue;
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "ref", index });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

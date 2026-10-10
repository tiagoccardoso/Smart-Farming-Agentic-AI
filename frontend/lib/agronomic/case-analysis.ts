/**
 * Regras da análise inicial de casos (rota /api/agronomic-ai/analyze-case).
 *
 * Causa raiz corrigida: a rota tem 60 s na Vercel, mas a cadeia
 * pesquisa externa (até 30 s) → provedor principal (até 60 s + retry) →
 * fallback (até 60 s + retry) não respeitava esse teto. A função era encerrada
 * pela plataforma, a resposta chegava sem JSON e a tela mostrava apenas
 * "Não foi possível gerar a análise agora". Além disso, as fotos do caso nunca
 * chegavam ao modelo: só as URLs entravam no texto do prompt.
 *
 * Aqui ficam o orçamento de tempo, a seleção/validação das fotos enviadas ao
 * modelo e os erros tipados. Sem dependências de servidor além de `fetch`.
 */

import type { AIImageInput } from "../../src/lib/ai/providers/types";
import { extractCaseStoragePath, storagePathBelongsToCase } from "./case-attachments";

/** Limite da função na Vercel (maxDuration = 60) menos folga para gravar e responder. */
export const ANALYSIS_BUDGET_MS = 54_000;
/** Tempo reservado depois da IA para gravar a análise, a fila de perguntas e responder. */
export const ANALYSIS_SAVE_RESERVE_MS = 5_000;
/** Teto da etapa de pesquisa (internet + base interna + carga das fotos). */
export const ANALYSIS_RESEARCH_CAP_MS = 12_000;
/** Menor janela útil para uma chamada de provedor valer a pena. */
export const ANALYSIS_MIN_PROVIDER_MS = 12_000;
/** Fotos enviadas ao modelo por análise (detalhe "low": custo e latência previsíveis). */
export const ANALYSIS_MAX_IMAGES = 4;

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type AnalysisErrorCode = "AI_TIMEOUT" | "AI_UNAVAILABLE" | "AI_INVALID_RESPONSE";

/** Falha real da IA: a rota responde com código próprio e NÃO grava análise falsa. */
export class AgronomicAnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly status: number;
  constructor(code: AnalysisErrorCode, message?: string) {
    super(message ?? ANALYSIS_ERROR_MESSAGES[code]);
    this.name = "AgronomicAnalysisError";
    this.code = code;
    this.status = code === "AI_TIMEOUT" ? 504 : code === "AI_UNAVAILABLE" ? 503 : 502;
  }
}

export const ANALYSIS_ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  AI_TIMEOUT:
    "A análise demorou mais que o esperado e foi interrompida. Seus dados e fotos continuam salvos no caso. Tente novamente em instantes.",
  AI_UNAVAILABLE:
    "O serviço de IA está indisponível no momento. Seus dados e fotos continuam salvos no caso. Tente novamente em alguns minutos.",
  AI_INVALID_RESPONSE:
    "A IA respondeu em um formato inesperado. Seus dados e fotos continuam salvos no caso. Tente gerar a análise novamente.",
};

/** Classifica a falha de um provedor sem expor a mensagem original ao usuário. */
export function classifyProviderFailure(error: unknown): AnalysisErrorCode {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout|tempo limite|timed out/i.test(message)) return "AI_TIMEOUT";
  if (/json|formato|parse|resposta vazia|empty/i.test(message)) return "AI_INVALID_RESPONSE";
  return "AI_UNAVAILABLE";
}

export function remainingMs(deadlineAt: number | undefined, now = Date.now()) {
  return typeof deadlineAt === "number" ? deadlineAt - now : Number.POSITIVE_INFINITY;
}

/** Orçamento da etapa de pesquisa: nunca consome o tempo que a IA precisa. */
export function researchBudgetMs(deadlineAt: number | undefined, now = Date.now()) {
  const left = remainingMs(deadlineAt, now);
  if (!Number.isFinite(left)) return ANALYSIS_RESEARCH_CAP_MS * 2;
  return Math.max(0, Math.min(ANALYSIS_RESEARCH_CAP_MS, left - ANALYSIS_SAVE_RESERVE_MS - ANALYSIS_MIN_PROVIDER_MS * 2));
}

/**
 * Tempo de uma chamada de provedor. Quando há fallback, a principal deixa uma
 * janela mínima para ele; sem fallback, usa tudo que sobra antes da reserva.
 */
export function providerTimeoutMs(input: { deadlineAt?: number; hasFallback: boolean; defaultMs: number; now?: number }) {
  const left = remainingMs(input.deadlineAt, input.now) - ANALYSIS_SAVE_RESERVE_MS;
  if (!Number.isFinite(left)) return input.defaultMs;
  const keepForFallback = input.hasFallback && left >= ANALYSIS_MIN_PROVIDER_MS * 2 ? ANALYSIS_MIN_PROVIDER_MS : 0;
  return Math.min(input.defaultMs, Math.max(0, left - keepForFallback));
}

/** Resolve a promessa ou devolve `onTimeout()` quando o tempo acabar (sem lançar). */
export async function settleWithin<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  if (ms <= 0) {
    promise.catch(() => undefined);
    return onTimeout();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type AnalysisImageCandidate = { url: string; label: string; imageType?: string | null };
export type LoadedAnalysisImage = AnalysisImageCandidate & { input: AIImageInput };
export type UnavailableAnalysisImage = AnalysisImageCandidate & { reason: string };
export type AnalysisImagesResult = {
  total: number;
  loaded: LoadedAnalysisImage[];
  unavailable: UnavailableAnalysisImage[];
  /** Fotos do caso além do limite por análise (não são enviadas, mas são informadas). */
  skipped: number;
};

/** Fotos do caso selecionadas para a análise, limitadas ao máximo por análise. */
export function selectAnalysisImages(
  images: Array<{ image_url?: string | null; image_type?: string | null; created_at?: string | null }>,
  max = ANALYSIS_MAX_IMAGES,
) {
  const valid = images.filter((image): image is { image_url: string; image_type?: string | null; created_at?: string | null } => Boolean(image.image_url));
  const unique = valid.filter((image, index) => valid.findIndex((other) => other.image_url === image.image_url) === index);
  // Fotos do cadastro do caso antes das enviadas no chat; dentro de cada grupo, as mais recentes.
  const isChat = (image: { image_type?: string | null }) => (image.image_type === "chat_image" ? 1 : 0);
  const ordered = [...unique].sort((a, b) => isChat(a) - isChat(b) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const selected = ordered.slice(0, max).map((image, index) => ({
    url: image.image_url,
    imageType: image.image_type ?? null,
    label: image.image_type === "chat_image" ? `foto ${index + 1} (enviada no chat)` : `foto ${index + 1} do caso`,
  }));
  return { selected, total: unique.length, skipped: Math.max(0, unique.length - selected.length) };
}

/**
 * Baixa as fotos e envia o CONTEÚDO (base64) ao modelo. Só aceita arquivos do
 * storage do projeto e da pasta do próprio usuário/caso — o servidor nunca
 * busca URLs arbitrárias e um caso não "empresta" fotos de outro.
 */
export async function loadAnalysisImages(input: {
  images: Array<{ image_url?: string | null; image_type?: string | null; created_at?: string | null }>;
  userId: string;
  caseId: string;
  allowedPrefix: string;
  max?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<AnalysisImagesResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { selected, total, skipped } = selectAnalysisImages(input.images, input.max);
  const loaded: Array<LoadedAnalysisImage | undefined> = [];
  const unavailable: Array<UnavailableAnalysisImage | undefined> = [];

  await Promise.all(
    selected.map(async (candidate, index) => {
      const path = extractCaseStoragePath(candidate.url);
      if (!candidate.url.startsWith(input.allowedPrefix) || !storagePathBelongsToCase(path, input.userId, input.caseId)) {
        unavailable[index] = { ...candidate, reason: "origem não permitida" };
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000);
      try {
        const response = await fetchImpl(candidate.url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          unavailable[index] = { ...candidate, reason: "arquivo não encontrado no armazenamento" };
          return;
        }
        const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
          unavailable[index] = {
            ...candidate,
            reason: /hei[cf]/.test(mimeType) || /\.(heic|heif)$/i.test(path ?? "") ? "formato HEIC/HEIF não suportado pela IA" : "formato não suportado pela IA",
          };
          return;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) {
          unavailable[index] = { ...candidate, reason: "arquivo vazio" };
          return;
        }
        if (buffer.length > MAX_IMAGE_BYTES) {
          unavailable[index] = { ...candidate, reason: "arquivo grande demais para a IA" };
          return;
        }
        loaded[index] = { ...candidate, input: { base64: buffer.toString("base64"), mimeType, description: candidate.label } };
      } catch {
        unavailable[index] = { ...candidate, reason: "falha ao carregar o arquivo" };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return {
    total,
    skipped,
    loaded: loaded.filter((item): item is LoadedAnalysisImage => Boolean(item)),
    unavailable: unavailable.filter((item): item is UnavailableAnalysisImage => Boolean(item)),
  };
}

/** Texto do prompt sobre as fotos (sem URLs: o modelo recebe o arquivo, não o link). */
export function describeAnalysisImages(result: AnalysisImagesResult | null) {
  if (!result || result.total === 0) return "Nenhuma imagem anexada.";
  const lines = [
    ...result.loaded.map((image, index) => `${index + 1}. ${image.label}: anexada a esta mensagem (imagem ${index + 1} da sequência). Analise o conteúdo visual.`),
    ...result.unavailable.map((image) => `- ${image.label}: NÃO foi possível enviar à IA (${image.reason}). Não descreva o conteúdo desta foto; se for importante, peça ao produtor uma foto em JPG ou PNG.`),
  ];
  if (result.skipped > 0) {
    lines.push(`- Outras ${result.skipped} foto(s) do caso não foram enviadas nesta análise (limite de ${ANALYSIS_MAX_IMAGES} por análise); considere apenas as fotos anexadas.`);
  }
  return lines.join("\n");
}

/** Resumo público (sem URLs) devolvido à tela e gravado junto com a análise. */
export function summarizeAnalysisImages(result: AnalysisImagesResult | null) {
  return {
    total: result?.total ?? 0,
    analyzed: result?.loaded.length ?? 0,
    skipped: result?.skipped ?? 0,
    unavailable: (result?.unavailable ?? []).map((image) => ({ label: image.label, reason: image.reason })),
  };
}

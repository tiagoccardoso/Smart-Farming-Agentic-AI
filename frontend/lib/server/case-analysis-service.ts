/**
 * Análise inicial de casos em processamento durável.
 *
 * Fluxo:
 *  1. start  (POST): valida, registra o job (um ativo por caso), faz a
 *     pesquisa e carrega as fotos (com teto de tempo) e cria a resposta no
 *     provedor em modo background. Responde em segundos.
 *  2. poll   (GET):  consulta o provedor; quando a resposta fica pronta, UM
 *     processo "reivindica" o job (processing → saving), normaliza, grava no
 *     caso e só então marca "completed".
 *
 * Nada depende de a função continuar viva depois de responder: o trabalho
 * longo fica no provedor e o resultado é gravado na próxima consulta, seja da
 * tela aberta, seja quando o usuário reabre o caso.
 */

import {
  ANALYSIS_ERROR_MESSAGES,
  ANALYSIS_SAVE_RESERVE_MS,
  AgronomicAnalysisError,
  JOB_MAX_PROCESSING_MS,
  JOB_MAX_SAVE_ATTEMPTS,
  JOB_SAVING_STALE_MS,
  JOB_START_STALE_MS,
  classifyProviderFailure,
  summarizeAnalysisImages,
  timeLeftMs,
  type AnalysisErrorCode,
} from "../agronomic/case-analysis";
import type { AnalysisJob, AnalysisJobStore } from "./analysis-jobs";
import type {
  AgronomicAnalysisContext,
  PreparedAgronomicAnalysis,
} from "../../src/lib/ai/orchestrator/analyze-case";
import type { AIProvider, AgronomicAnalysisOutput } from "../../src/lib/ai/providers/types";
import type { BackgroundResponseState } from "../../src/lib/ai/providers/openai";

export type ImageAnalysisSummary = ReturnType<typeof summarizeAnalysisImages>;

export type BackgroundClient = {
  start(messages: PreparedAgronomicAnalysis["messages"], options: { model: string; maxOutputTokens: number }): Promise<BackgroundResponseState>;
  get(id: string, options: { model?: string }): Promise<BackgroundResponseState>;
  cancel(id: string): Promise<unknown>;
};

export type AnalysisServiceDeps = {
  store: AnalysisJobStore;
  background: BackgroundClient | null;
  /** Normaliza o conteúdo do modelo usando o contexto salvo no job. */
  complete: (content: unknown, context: AgronomicAnalysisContext) => AgronomicAnalysisOutput;
  /** Grava a análise no caso (fila de perguntas, histórico, uso e chat). */
  persist: (analysis: AgronomicAnalysisOutput & { imageAnalysis: ImageAnalysisSummary }) => Promise<unknown>;
  /** Registro de uso/custo (ai_usage_logs); falhas são ignoradas. */
  logUsage?: (input: { model: string; usage?: BackgroundResponseState["usage"]; responseTimeMs: number; success: boolean }) => Promise<unknown>;
  log?: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
};

export type AnalysisJobView =
  | { state: "idle" }
  | { state: "processing" | "saving"; job: AnalysisJob; reused?: boolean }
  | { state: "completed"; job: AnalysisJob; analysis?: AgronomicAnalysisOutput }
  | { state: "failed"; job: AnalysisJob; code: AnalysisErrorCode; message: string; retryable: boolean };

const RETRYABLE_CODES: AnalysisErrorCode[] = ["AI_TIMEOUT", "AI_UNAVAILABLE", "AI_INVALID_RESPONSE", "SAVE_FAILED"];

function asErrorCode(value: string | null | undefined): AnalysisErrorCode {
  return value && value in ANALYSIS_ERROR_MESSAGES ? (value as AnalysisErrorCode) : "AI_UNAVAILABLE";
}

export function viewOfJob(job: AnalysisJob | null): AnalysisJobView {
  if (!job) return { state: "idle" };
  if (job.status === "failed") {
    const code = asErrorCode(job.error_code);
    return { state: "failed", job, code, message: ANALYSIS_ERROR_MESSAGES[code], retryable: RETRYABLE_CODES.includes(code) };
  }
  if (job.status === "completed") return { state: "completed", job };
  return { state: job.status, job };
}

function age(iso: string | null | undefined, now: number) {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) ? now - time : 0;
}

async function fail(deps: AnalysisServiceDeps, job: AnalysisJob, from: AnalysisJob["status"][], code: AnalysisErrorCode, extra: Record<string, unknown> = {}) {
  const updated = await deps.store.transition(job.id, from, { status: "failed", error_code: code, completed_at: new Date((deps.now ?? Date.now)()).toISOString() });
  deps.log?.("job_failed", { jobId: job.id, caseId: job.case_id, requestId: job.request_id, code, ...extra });
  return updated ?? (await deps.store.latestForCase(job.case_id));
}

/* ------------------------------------------------------------------ start */

export async function startCaseAnalysis(input: {
  caseId: string;
  userId: string;
  requestId: string;
  deadlineAt: number;
  prepare: () => Promise<PreparedAgronomicAnalysis>;
  selectModel: (complexity: PreparedAgronomicAnalysis["complexity"]) => string;
  maxOutputTokens: number;
  /** Provedor síncrono alternativo (ex.: Gemini) quando o background não pode ser iniciado. */
  syncFallback?: { provider: AIProvider; model: string } | null;
  deps: AnalysisServiceDeps;
}): Promise<AnalysisJobView> {
  const { deps } = input;
  const now = deps.now ?? Date.now;

  // 1. Já existe análise ativa? Acompanhar em vez de iniciar outra.
  const latest = await deps.store.latestForCase(input.caseId);
  if (latest && (latest.status === "processing" || latest.status === "saving")) {
    const stalledStart = latest.status === "processing" && !latest.provider_response_id && age(latest.started_at, now()) > JOB_START_STALE_MS;
    if (!stalledStart) return { ...viewOfJob(latest), reused: true } as AnalysisJobView;
    await fail(deps, latest, ["processing"], "AI_TIMEOUT", { reason: "start_stalled" });
  }

  // 2. Registro atômico (índice único: um job ativo por caso entre instâncias).
  const inserted = await deps.store.insert({ case_id: input.caseId, user_id: input.userId, request_id: input.requestId });
  if (inserted === "conflict") {
    const active = await deps.store.latestForCase(input.caseId);
    return active ? ({ ...viewOfJob(active), reused: true } as AnalysisJobView) : { state: "idle" };
  }
  const job = inserted;
  const startedAt = now();

  // 3. Pesquisa + fotos (com teto) e montagem das mensagens.
  let prepared: PreparedAgronomicAnalysis;
  try {
    prepared = await input.prepare();
  } catch (error) {
    await fail(deps, job, ["processing"], "AI_UNAVAILABLE", { stage: "prepare", errorName: error instanceof Error ? error.name : typeof error });
    throw new AgronomicAnalysisError("AI_UNAVAILABLE");
  }
  const imageSummary = summarizeAnalysisImages(prepared.images);
  deps.log?.("stage_prepared", {
    jobId: job.id,
    caseId: input.caseId,
    requestId: input.requestId,
    researchMs: prepared.researchMs,
    imagesTotal: imageSummary.total,
    imagesAnalyzed: imageSummary.analyzed,
    imagesUnavailable: imageSummary.unavailable.length,
  });

  // 4. Processamento durável no provedor.
  const model = input.selectModel(prepared.complexity);
  let startError: unknown = null;
  if (input.deps.background) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const providerStart = now();
        const state = await input.deps.background.start(prepared.messages, { model, maxOutputTokens: input.maxOutputTokens });
        const saved = await deps.store.transition(job.id, ["processing"], {
          provider: "openai",
          model: state.model || model,
          provider_response_id: state.id,
          image_summary: imageSummary,
          context: prepared.context,
        });
        deps.log?.("stage_provider_started", {
          jobId: job.id,
          caseId: input.caseId,
          requestId: input.requestId,
          model,
          providerStatus: state.status,
          startMs: now() - providerStart,
          totalMs: now() - startedAt,
        });
        if (!saved) return viewOfJob(await deps.store.latestForCase(input.caseId));
        return { state: "processing", job: saved };
      } catch (error) {
        startError = error;
        const transient = Boolean((error as { transient?: boolean })?.transient);
        deps.log?.("stage_provider_start_failed", { jobId: job.id, requestId: input.requestId, attempt, transient, status: (error as { status?: number })?.status ?? null });
        // Nova tentativa só para falha temporária e se ainda couber no tempo.
        if (!transient || timeLeftMs(input.deadlineAt, now()) < 15_000) break;
      }
    }
  }

  // 5. Sem background (ou falhou ao iniciar): provedor alternativo síncrono,
  //    somente se couber no tempo restante desta requisição.
  const fallback = input.syncFallback;
  const left = timeLeftMs(input.deadlineAt, now()) - ANALYSIS_SAVE_RESERVE_MS;
  if (fallback && left >= 15_000) {
    try {
      const syncStart = now();
      const result = await fallback.provider.generateStructuredOutput<Partial<AgronomicAnalysisOutput>>(prepared.messages, {
        model: fallback.model,
        promptType: "agronomic_analysis",
        maxOutputTokens: input.maxOutputTokens,
        timeoutMs: left,
      });
      await deps.store.transition(job.id, ["processing"], { provider: fallback.provider.name, model: result.model, image_summary: imageSummary, context: prepared.context });
      deps.log?.("stage_sync_fallback_done", { jobId: job.id, requestId: input.requestId, provider: fallback.provider.name, ms: now() - syncStart });
      const refreshed = (await deps.store.latestForCase(input.caseId)) ?? job;
      return await finalize(refreshed, result.content, deps, { model: result.model, usage: result.usage, responseTimeMs: result.responseTimeMs });
    } catch (error) {
      deps.log?.("stage_sync_fallback_failed", { jobId: job.id, requestId: input.requestId, category: error instanceof AgronomicAnalysisError ? error.code : classifyProviderFailure(error) });
      if (!startError) startError = error;
    }
  }

  const code: AnalysisErrorCode = startError ? classifyProviderFailure(startError) === "AI_TIMEOUT" ? "AI_TIMEOUT" : "AI_UNAVAILABLE" : "AI_UNAVAILABLE";
  await fail(deps, job, ["processing", "saving"], code, { stage: "start" });
  throw new AgronomicAnalysisError(code);
}

/* --------------------------------------------------------------- finalize */

async function finalize(
  job: AnalysisJob,
  content: unknown,
  deps: AnalysisServiceDeps,
  usage: { model: string; usage?: BackgroundResponseState["usage"]; responseTimeMs: number },
): Promise<AnalysisJobView> {
  const now = deps.now ?? Date.now;
  // Só um processo grava: troca atômica processing → saving.
  const claimed = await deps.store.transition(job.id, ["processing"], { status: "saving" });
  if (!claimed) return viewOfJob(await deps.store.latestForCase(job.case_id));

  let analysis: AgronomicAnalysisOutput;
  try {
    analysis = deps.complete(content, claimed.context as AgronomicAnalysisContext);
  } catch {
    const failed = await fail(deps, claimed, ["saving"], "AI_INVALID_RESPONSE", { stage: "parse" });
    await deps.logUsage?.({ ...usage, success: false });
    return viewOfJob(failed);
  }

  const saveStart = now();
  try {
    await deps.persist({ ...analysis, imageAnalysis: (claimed.image_summary as ImageAnalysisSummary) ?? summarizeAnalysisImages(null) });
  } catch (error) {
    const attempts = (claimed.save_attempts ?? 0) + 1;
    deps.log?.("stage_save_failed", { jobId: job.id, requestId: job.request_id, attempts, errorName: error instanceof Error ? error.name : typeof error });
    if (attempts >= JOB_MAX_SAVE_ATTEMPTS) {
      return viewOfJob(await fail(deps, claimed, ["saving"], "SAVE_FAILED", { attempts }));
    }
    // A resposta continua guardada no provedor: a próxima consulta tenta gravar de novo.
    const back = await deps.store.transition(claimed.id, ["saving"], { status: "processing", save_attempts: attempts });
    return viewOfJob(back ?? (await deps.store.latestForCase(job.case_id)));
  }

  const completed = await deps.store.transition(claimed.id, ["saving"], { status: "completed", completed_at: new Date(now()).toISOString(), error_code: null });
  await deps.logUsage?.({ ...usage, success: true });
  deps.log?.("job_completed", {
    jobId: job.id,
    caseId: job.case_id,
    requestId: job.request_id,
    saveMs: now() - saveStart,
    totalMs: age(job.started_at, now()),
  });
  return { state: "completed", job: completed ?? claimed, analysis };
}

/* ------------------------------------------------------------------- poll */

export async function pollCaseAnalysis(input: { caseId: string; userId: string; deps: AnalysisServiceDeps }): Promise<AnalysisJobView & { providerCheckFailed?: boolean }> {
  const { deps } = input;
  const now = deps.now ?? Date.now;
  let job = await deps.store.latestForCase(input.caseId);
  if (!job || job.user_id !== input.userId) return { state: "idle" };

  if (job.status === "saving") {
    if (age(job.updated_at, now()) <= JOB_SAVING_STALE_MS) return viewOfJob(job);
    // Quem gravava caiu no meio: devolve para "processing" e retoma abaixo.
    job = (await deps.store.transition(job.id, ["saving"], { status: "processing" })) ?? job;
    if (job.status !== "processing") return viewOfJob(job);
  }
  if (job.status !== "processing") return viewOfJob(job);

  if (!job.provider_response_id) {
    if (age(job.started_at, now()) > JOB_START_STALE_MS) {
      return viewOfJob(await fail(deps, job, ["processing"], "AI_TIMEOUT", { reason: "start_stalled" }));
    }
    return viewOfJob(job);
  }

  if (age(job.started_at, now()) > JOB_MAX_PROCESSING_MS) {
    // Não deixar o provedor gastando com um resultado que não será usado.
    await deps.background?.cancel(job.provider_response_id).catch(() => null);
    return viewOfJob(await fail(deps, job, ["processing"], "AI_TIMEOUT", { reason: "max_processing" }));
  }

  if (!deps.background) return viewOfJob(job);

  let state: BackgroundResponseState;
  try {
    state = await deps.background.get(job.provider_response_id, { model: job.model ?? undefined });
  } catch (error) {
    // Falha ao CONSULTAR não é falha da análise: continua em processamento.
    deps.log?.("poll_provider_unreachable", { jobId: job.id, requestId: job.request_id, transient: Boolean((error as { transient?: boolean })?.transient) });
    return { ...viewOfJob(job), providerCheckFailed: true } as AnalysisJobView & { providerCheckFailed: boolean };
  }

  if (state.status === "queued" || state.status === "in_progress") return viewOfJob(job);

  const responseTimeMs = age(job.started_at, now());
  if (state.status === "completed") {
    return finalize(job, state.content ?? "", deps, { model: state.model || job.model || "", usage: state.usage, responseTimeMs });
  }

  // failed | cancelled | incomplete (ex.: saída truncada por max_output_tokens)
  await deps.logUsage?.({ model: state.model || job.model || "", usage: state.usage, responseTimeMs, success: false });
  const code: AnalysisErrorCode = state.status === "incomplete" ? "AI_INVALID_RESPONSE" : "AI_UNAVAILABLE";
  return viewOfJob(await fail(deps, job, ["processing"], code, { providerStatus: state.status, reason: state.reason ?? null }));
}

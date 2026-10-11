"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgronomicCase, AgronomicPreAnalysis } from "../../../lib/agronomic/case";
import type { AnalysisHistoryEntry, CaseFreshness } from "../../../lib/agronomic/case-freshness";
import type { ChatMessageRow } from "../../../lib/agronomic/case-chat";
import { REVIEW_STAGE_INFO, getClientReviewStage, type ClientHumanReview } from "../../../lib/agronomic/client-review";
import { normalizeAiResponseText } from "../../../lib/agronomic/ai-response-formatting";
import { LEVEL_LABELS } from "../../../lib/agronomic/analysis-sections";
import type { ReloadedCase } from "../../../lib/agronomic/case-save";
import AnalysisAccordion from "./AnalysisAccordion";
import CaseChat from "./CaseChat";
import CaseEditor from "./CaseEditor";
import ImageLightbox from "./ImageLightbox";
import { IconAlert, IconCheck, IconChevron, IconDoc, IconEdit, IconRetry, IconSparkle, IconUser } from "./icons";

type ActivityLog = { id: string; action: string; metadata?: Record<string, unknown> | null; created_at: string | null };

type CasePayload = {
  case: AgronomicCase;
  activityLogs?: ActivityLog[];
  analysisHistory?: AnalysisHistoryEntry[];
  freshness?: CaseFreshness;
  humanReview?: ClientHumanReview | null;
};

type Banner = { tone: "success" | "error" | "info"; text: string; detail?: string; retry?: boolean } | null;

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function InfoChip({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <p className="text-[0.68rem] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

const ACTIVITY_LABELS: Record<string, string> = {
  case_updated: "Informações do caso atualizadas",
  attachment_added: "Novo anexo",
};

function activityLabel(log: ActivityLog) {
  const kind = typeof log.metadata?.kind === "string" ? log.metadata.kind : null;
  if (kind === "attachment_added") return log.metadata?.attachment === "soil_analysis" ? "Análise de solo anexada" : "Nova foto anexada";
  if (kind && ACTIVITY_LABELS[kind]) return ACTIVITY_LABELS[kind];
  return log.action;
}

type ImageAnalysisSummary = { total: number; analyzed: number; skipped: number; unavailable: Array<{ label: string; reason: string }> };

type AnalysisJobInfo = {
  status: "processing" | "saving";
  startedAt: string | null;
  requestId: string | null;
  providerCheckFailed?: boolean;
};

type AnalysisApiResult =
  | { kind: "completed"; imageAnalysis: ImageAnalysisSummary | null; justFinished: boolean }
  | { kind: "processing"; job: AnalysisJobInfo }
  | { kind: "idle" }
  | { kind: "error"; message: string; reference: string | null; retryable: boolean; finishedAt?: string | null }
  | { kind: "network"; aborted: boolean };

/** Teto de espera de UMA requisição (o início leva segundos; o fluxo legado, até 1 min). */
const ANALYSIS_CLIENT_TIMEOUT_MS = 75_000;
const POLL_FAST_MS = 3_000;
const POLL_SLOW_MS = 6_000;
const POLL_OFFLINE_MS = 10_000;

/**
 * Inicia (POST) ou acompanha (GET) a análise e traduz a resposta. A rota
 * responde 202 enquanto a IA processa; uma falha de conexão aqui NÃO significa
 * que a análise falhou — ela continua no servidor.
 */
async function callAnalysisApi(method: "POST" | "GET", caseId: string, token: string, signal?: AbortSignal): Promise<AnalysisApiResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ANALYSIS_CLIENT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  let response: Response;
  try {
    response = await fetch(
      method === "GET" ? `/api/agronomic-ai/analyze-case?caseId=${encodeURIComponent(caseId)}` : "/api/agronomic-ai/analyze-case",
      {
        method,
        headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
        ...(method === "POST" ? { body: JSON.stringify({ caseId }) } : {}),
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    return { kind: "network", aborted: error instanceof DOMException && error.name === "AbortError" };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  const text = await response.text().catch(() => "");
  let payload: {
    status?: string;
    error?: string;
    code?: string;
    requestId?: string;
    startedAt?: string;
    retryable?: boolean;
    providerCheckFailed?: boolean;
    imageAnalysis?: ImageAnalysisSummary | null;
    analysis?: unknown;
    deduplicated?: boolean;
    finishedAt?: string | null;
  } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (response.ok && (payload?.status === "processing" || payload?.status === "saving")) {
    return {
      kind: "processing",
      job: { status: payload.status, startedAt: payload.startedAt ?? null, requestId: payload.requestId ?? null, providerCheckFailed: Boolean(payload.providerCheckFailed) },
    };
  }
  if (response.ok && (payload?.status === "idle" || payload?.status === "unsupported")) return { kind: "idle" };
  // `analysis` presente = a análise foi gravada nesta requisição.
  if (response.ok && payload) return { kind: "completed", imageAnalysis: payload.imageAnalysis ?? null, justFinished: Boolean(payload.analysis) };

  const reference = payload?.requestId ?? response.headers.get("x-vercel-id")?.split("::").pop() ?? null;
  if (payload?.error) {
    const retryable =
      payload.retryable ??
      (!["PLAN_LIMIT_REACHED", "AUTH_REQUIRED"].includes(payload.code ?? "") && ![401, 402, 403, 404, 429].includes(response.status));
    return { kind: "error", message: payload.error, reference, retryable, finishedAt: payload.finishedAt ?? null };
  }
  if (response.status === 401) {
    return { kind: "error", retryable: false, reference, message: "Sua sessão expirou. Faça login novamente para gerar a análise." };
  }
  // Resposta sem JSON (erro da plataforma): não dá para afirmar que a análise
  // parou. O componente confere o andamento antes de oferecer nova tentativa.
  return { kind: "network", aborted: false };
}

function formatElapsed(startedAt: string | null, now: number) {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
}

function describeImageAnalysis(summary: ImageAnalysisSummary | null) {
  if (!summary || summary.total === 0) return undefined;
  const parts = [`A IA analisou ${summary.analyzed} de ${summary.total} ${summary.total === 1 ? "foto" : "fotos"}.`];
  if (summary.unavailable.length) {
    const reasons = Array.from(new Set(summary.unavailable.map((item) => item.reason)));
    parts.push(`${summary.unavailable.length} não ${summary.unavailable.length === 1 ? "pôde ser lida" : "puderam ser lidas"} (${reasons.join("; ")}). Para incluí-las, envie em JPG ou PNG.`);
  }
  if (summary.skipped > 0) parts.push(`${summary.skipped} ficaram de fora pelo limite de fotos por análise.`);
  return parts.join(" ");
}

export default function CaseDetailPanel({
  caseId,
  getAccessToken,
  analysesRemaining,
  openEditorOnLoad,
  onEditorOpened,
  onCaseUpdated,
  onRequestHumanReview,
  requestingHumanReview,
  onDelete,
  onToast,
}: {
  caseId: string;
  getAccessToken: () => string | null;
  analysesRemaining: number | null;
  openEditorOnLoad?: boolean;
  onEditorOpened?: () => void;
  onCaseUpdated: (caseData: AgronomicCase) => void;
  onRequestHumanReview: (caseId: string) => void;
  requestingHumanReview: boolean;
  onDelete: (caseId: string) => void;
  onToast: (type: "success" | "error", message: string) => void;
}) {
  const [data, setData] = useState<CasePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const generatingRef = useRef(false);
  const requestIdRef = useRef(0);
  // Análise em processamento no servidor (estado real vindo da API).
  const [job, setJob] = useState<AnalysisJobInfo | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const pollTimerRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollAttemptRef = useRef(0);
  // O POST falhou por conexão: ainda não sabemos se a análise começou.
  const startUncertainRef = useRef(false);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const token = getAccessToken();
      if (!token) {
        setLoadError("Faça login para abrir o caso.");
        setLoading(false);
        return null;
      }
      const requestId = ++requestIdRef.current;
      if (!options.silent) setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as (CasePayload & { error?: string }) | null;
        if (requestId !== requestIdRef.current) return null;
        if (!response.ok || !payload?.case) throw new Error(payload?.error || "Não foi possível carregar o caso.");
        setData(payload);
        onCaseUpdated(payload.case);
        return payload;
      } catch (error) {
        if (requestId === requestIdRef.current) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar o caso.");
        return null;
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    // onCaseUpdated é estável no pai (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseId, getAccessToken],
  );

  useEffect(() => {
    setData(null);
    setBanner(null);
    setShowDetails(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (openEditorOnLoad && data?.case && !editorOpen) {
      setEditorOpen(true);
      onEditorOpened?.();
    }
  }, [openEditorOnLoad, data?.case, editorOpen, onEditorOpened]);

  const caseData = data?.case ?? null;
  const analysis = (caseData?.ai_analysis_json ?? null) as AgronomicPreAnalysis | null;
  const hasAnalysis = Boolean(analysis || caseData?.ai_summary);
  const freshness = data?.freshness;
  const pendingQuestions = useMemo(
    () => (caseData?.pending_questions ?? []).filter((item) => item.status === "pending").map((item) => normalizeAiResponseText(item.question)),
    [caseData?.pending_questions],
  );
  const images = useMemo(() => (caseData?.images ?? []).map((image) => ({ id: image.id, url: image.image_url, label: image.image_type === "chat_image" ? "Foto enviada no chat" : "Foto do caso" })), [caseData?.images]);
  const stage = caseData ? getClientReviewStage(caseData) : "not_requested";
  const stageInfo = REVIEW_STAGE_INFO[stage];
  const review = data?.humanReview ?? null;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const finishWithResult = useCallback(
    async (result: AnalysisApiResult, previouslyHadAnalysis: boolean) => {
      if (result.kind === "completed") {
        setJob(null);
        setConnectionLost(false);
        // Sucesso só depois de a análise estar gravada e recarregada do servidor.
        await load({ silent: true });
        setBanner({ tone: "success", text: previouslyHadAnalysis ? "Análise atualizada com sucesso." : "Análise gerada com sucesso.", detail: describeImageAnalysis(result.imageAnalysis) });
        return;
      }
      if (result.kind === "error") {
        setJob(null);
        setConnectionLost(false);
        setBanner({ tone: "error", text: result.message, detail: result.reference ? `Código para suporte: ${result.reference}` : undefined, retry: result.retryable });
      }
    },
    [load],
  );

  /** Consulta o andamento uma vez e agenda a próxima consulta se ainda estiver processando. */
  const pollOnce = useCallback(
    async (previouslyHadAnalysis: boolean, quiet = false) => {
      const token = getAccessToken();
      if (!token) return;
      stopPolling();
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const result = await callAnalysisApi("GET", caseId, token, controller.signal);
      if (controller.signal.aborted) return;
      pollAttemptRef.current += 1;
      const schedule = (ms: number) => {
        pollTimerRef.current = window.setTimeout(() => void pollOnce(previouslyHadAnalysis), ms);
      };
      if (result.kind === "processing") {
        startUncertainRef.current = false;
        setJob(result.job);
        setConnectionLost(false);
        setBanner(null);
        schedule(pollAttemptRef.current < 10 ? POLL_FAST_MS : POLL_SLOW_MS);
        return;
      }
      if (result.kind === "network") {
        // Consulta de abertura sem conexão: nada a afirmar, não insiste.
        if (quiet) return;
        // A análise continua no servidor; só a consulta falhou.
        setConnectionLost(true);
        schedule(POLL_OFFLINE_MS);
        return;
      }
      if (result.kind === "idle") {
        setJob(null);
        setConnectionLost(false);
        if (startUncertainRef.current) {
          startUncertainRef.current = false;
          setBanner({ tone: "error", text: "A análise não chegou a ser iniciada por falha de conexão. Seus dados e fotos continuam no caso.", retry: true });
        }
        return;
      }
      startUncertainRef.current = false;
      if (quiet) {
        // Ao abrir o caso, só avisa sobre análises que terminaram há pouco
        // (o usuário saiu da tela durante o processamento).
        const recent = result.kind === "error" && result.finishedAt ? Date.now() - Date.parse(result.finishedAt) < 15 * 60_000 : false;
        if (!(result.kind === "completed" && result.justFinished) && !recent) {
          setJob(null);
          return;
        }
      }
      await finishWithResult(result, previouslyHadAnalysis);
    },
    [caseId, getAccessToken, stopPolling, finishWithResult],
  );

  // Ao abrir o caso: retoma o acompanhamento se houver análise em andamento
  // (ex.: o usuário saiu da tela ou recarregou a página durante o processamento).
  const caseLoaded = Boolean(data?.case);
  useEffect(() => {
    if (!caseLoaded) return;
    pollAttemptRef.current = 0;
    void pollOnce(Boolean(data?.case?.ai_analysis_json || data?.case?.ai_summary), true);
    return stopPolling;
    // Só na abertura do caso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, caseLoaded]);

  useEffect(() => stopPolling, [stopPolling]);

  // Relógio do tempo decorrido (real, vindo do início registrado no servidor).
  useEffect(() => {
    if (!job) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  async function generateAnalysis() {
    const token = getAccessToken();
    if (!token) {
      setBanner({ tone: "error", text: "Sua sessão expirou. Faça login novamente para gerar a análise." });
      return;
    }
    if (generatingRef.current || job) return;
    generatingRef.current = true;
    setGenerating(true);
    setConnectionLost(false);
    const photoCount = caseData?.images?.length ?? 0;
    setBanner({
      tone: "info",
      text: photoCount ? `Preparando as ${photoCount === 1 ? "informações e a foto" : `informações e ${photoCount} fotos`} para a IA…` : "Preparando as informações do caso para a IA…",
    });
    try {
      const result = await callAnalysisApi("POST", caseId, token);
      if (result.kind === "processing") {
        setJob(result.job);
        setBanner(null);
        pollAttemptRef.current = 0;
        pollTimerRef.current = window.setTimeout(() => void pollOnce(hasAnalysis), POLL_FAST_MS);
      } else if (result.kind === "network") {
        // Não sabemos se o servidor recebeu: confere o andamento antes de oferecer nova tentativa.
        setBanner(null);
        setConnectionLost(true);
        startUncertainRef.current = true;
        pollAttemptRef.current = 0;
        await pollOnce(hasAnalysis);
      } else if (result.kind === "idle") {
        setBanner(null);
      } else {
        await finishWithResult(result, hasAnalysis);
      }
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  const analysisBusy = generating || Boolean(job);
  const elapsed = job ? formatElapsed(job.startedAt, clock) : null;

  function handleSaved(_reloaded: ReloadedCase, info: { message: string }) {
    if (info.message) {
      setEditorOpen(false);
      setBanner({ tone: "success", text: info.message });
      onToast("success", info.message);
    }
    void load({ silent: true });
  }

  if (loading && !data) {
    return (
      <div className="space-y-3 p-1" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-slate-500">Carregando caso...</p>
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
        <span>{loadError}</span>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-4 font-bold text-white">
          <IconRetry className="h-4 w-4" /> Tentar novamente
        </button>
      </div>
    );
  }

  if (!caseData) return null;

  const activity = (data?.activityLogs ?? []).slice().reverse();

  return (
    <div className="space-y-5" data-testid="case-detail">
      {/* Dados do caso */}
      <section aria-label="Dados do caso" className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InfoChip label="Local" value={[caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || null} />
          <InfoChip label="Área" value={caseData.farm?.area_hectares ? `${caseData.farm.area_hectares} ha` : null} />
          <InfoChip label="Estágio" value={caseData.growth_stage} />
          <InfoChip label="Solo" value={caseData.farm?.soil_type} />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-bold text-slate-800">
            Sintomas e histórico informados
            <IconChevron className={`h-5 w-5 text-slate-400 transition-transform ${showDetails ? "rotate-180" : ""}`} />
          </button>
          {showDetails ? (
            <div className="grid gap-3 border-t border-slate-100 px-4 pb-4 pt-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Sintomas</p>
                <p className="mt-1 whitespace-pre-wrap">{caseData.symptoms}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Histórico de manejo</p>
                <p className="mt-1 whitespace-pre-wrap">{caseData.history || "Não informado"}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {banner ? (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${
            banner.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : banner.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-sky-200 bg-sky-50 text-sky-800"
          }`}
          data-testid="case-banner"
        >
          {banner.tone === "success" ? <IconCheck className="mt-0.5 h-4 w-4" /> : banner.tone === "error" ? <IconAlert className="mt-0.5 h-4 w-4" /> : <span className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p>{banner.text}</p>
            {banner.detail ? <p className="mt-0.5 text-xs font-medium opacity-80">{banner.detail}</p> : null}
            {banner.retry && !analysisBusy ? (
              <button type="button" onClick={() => void generateAnalysis()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700" data-testid="retry-analysis">
                <IconRetry className="h-4 w-4" /> Tentar novamente
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {job ? (
        <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status" aria-live="polite" data-testid="analysis-job">
          <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {job.status === "saving" ? "A IA terminou. Salvando a análise no caso…" : "A IA está analisando o caso…"}
            </p>
            <p className="mt-0.5 text-xs font-medium text-sky-800">
              {elapsed ? `Iniciada há ${elapsed}. ` : ""}Você pode sair desta tela: a análise continua no servidor e aparece aqui quando estiver pronta.
            </p>
            {connectionLost ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="text-xs font-semibold text-amber-800">Sem conexão com o servidor agora. A análise não foi cancelada; vamos verificar de novo automaticamente.</p>
                <button type="button" onClick={() => void pollOnce(hasAnalysis)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 text-sm font-bold text-sky-800 hover:bg-sky-100">
                  <IconRetry className="h-4 w-4" /> Verificar agora
                </button>
              </div>
            ) : null}
            {job.requestId ? <p className="mt-1 text-[0.7rem] text-sky-700">Código para suporte: {job.requestId}</p> : null}
          </div>
        </div>
      ) : connectionLost ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
          <p className="font-semibold">Sem conexão com o servidor. Não foi possível confirmar se a análise começou; vamos verificar de novo automaticamente.</p>
          <button type="button" onClick={() => void pollOnce(hasAnalysis)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900">
            <IconRetry className="h-4 w-4" /> Verificar agora
          </button>
        </div>
      ) : null}

      {freshness?.hasUpdatesSinceAnalysis && !analysisBusy ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-gold-300 bg-gold-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="freshness-banner">
          <div className="text-sm text-gold-900">
            <p className="font-bold">Novas informações disponíveis para análise</p>
            <p className="text-gold-800">
              {freshness.updatesSinceAnalysis === 1 ? "1 atualização" : `${freshness.updatesSinceAnalysis} atualizações`} depois da última análise{freshness.analysisAt ? ` (${formatDate(freshness.analysisAt)})` : ""}.
              {analysesRemaining !== null ? ` Análises restantes no mês: ${analysesRemaining}.` : ""}
            </p>
          </div>
          <button type="button" onClick={() => void generateAnalysis()} disabled={analysisBusy || analysesRemaining === 0} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-leaf-700 px-5 text-sm font-bold text-white hover:bg-leaf-800 disabled:bg-slate-300">
            <IconSparkle className="h-4 w-4" /> Atualizar análise com IA
          </button>
        </div>
      ) : null}

      {/* Ações */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 hover:border-leaf-300" data-testid="open-editor">
          <IconEdit className="h-4 w-4" /> Editar caso
        </button>
        {!hasAnalysis || !freshness?.hasUpdatesSinceAnalysis ? (
          <button type="button" onClick={() => void generateAnalysis()} disabled={analysisBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-leaf-600 px-4 text-sm font-bold text-white hover:bg-leaf-700 disabled:bg-slate-300">
            <IconSparkle className="h-4 w-4" />
            {analysisBusy ? "Analisando..." : hasAnalysis ? "Gerar nova análise" : "Gerar análise com IA"}
          </button>
        ) : null}
        {stage === "not_requested" || stage === "cancelled" ? (
          <button type="button" onClick={() => onRequestHumanReview(caseId)} disabled={requestingHumanReview} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-moss-700 px-4 text-sm font-bold text-white hover:bg-moss-800 disabled:bg-slate-300 sm:col-span-1">
            <IconUser className="h-4 w-4" />
            {requestingHumanReview ? "Enviando..." : "Solicitar parecer da especialista"}
          </button>
        ) : null}
        <div className="relative col-span-2 sm:col-span-1">
          <button type="button" aria-expanded={showMore} onClick={() => setShowMore((value) => !value)} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
            Mais ações <IconChevron className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} />
          </button>
          {showMore ? (
            <div className="mt-2 grid gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft sm:absolute sm:right-0 sm:z-20 sm:w-60">
              <Link href={`/revisao-humana?caseId=${encodeURIComponent(caseId)}`} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ver acompanhamento do parecer</Link>
              <button type="button" onClick={() => { setShowMore(false); onDelete(caseId); }} className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-700 hover:bg-red-50">Excluir caso</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Parecer humano: identidade visual própria, separada da IA */}
      {stage !== "not_requested" ? (
        <section className="rounded-[1.5rem] border-2 border-moss-300 bg-gradient-to-br from-moss-50 to-white p-4 sm:p-5" aria-label="Parecer da especialista" data-testid="human-review-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 rounded-full bg-moss-700 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              <IconUser className="h-3.5 w-3.5" /> Parecer humano
            </p>
            <span className="rounded-full border border-moss-300 bg-white px-3 py-1 text-xs font-bold text-moss-700">{stageInfo.label}</span>
          </div>
          <h3 className="mt-3 text-lg font-black text-moss-900">{stageInfo.title}</h3>
          {review?.reviewText ? (
            <div className="mt-3 space-y-3 text-[0.95rem] leading-7 text-slate-800">
              <p className="whitespace-pre-wrap">{review.reviewText}</p>
              {review.technicalRecommendation ? (
                <div className="rounded-xl bg-white p-3 ring-1 ring-moss-200">
                  <p className="text-xs font-bold uppercase tracking-wide text-moss-600">Recomendação técnica</p>
                  <p className="mt-1 whitespace-pre-wrap">{review.technicalRecommendation}</p>
                </div>
              ) : null}
              {review.finalObservations ? <p className="whitespace-pre-wrap text-slate-600">{review.finalObservations}</p> : null}
              <p className="text-xs text-slate-500">{review.specialistName ? `Assinado por ${review.specialistName} · ` : ""}{review.reviewedAt ? formatDate(review.reviewedAt) : ""}</p>
            </div>
          ) : (
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {stageInfo.description} Informações, fotos e áudios que você adicionar ficam visíveis para a especialista no mesmo caso.
            </p>
          )}
          <Link href={`/revisao-humana?caseId=${encodeURIComponent(caseId)}`} className="mt-3 inline-flex text-sm font-bold text-moss-700 underline-offset-4 hover:underline">Abrir acompanhamento completo</Link>
        </section>
      ) : null}

      {/* Análise da IA */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 p-3 sm:p-4" aria-labelledby={`analysis-title-${caseId}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 id={`analysis-title-${caseId}`} className="text-lg font-black text-slate-950">Análise da IA</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
            <IconSparkle className="h-3.5 w-3.5" /> Gerada por IA · triagem informativa
          </span>
        </div>
        {hasAnalysis ? (
          <AnalysisAccordion
            key={analysis?.analyzedAt ?? caseData.ai_summary ?? "legacy"}
            analysis={analysis}
            reportedSymptoms={caseData.symptoms}
            pendingQuestions={pendingQuestions}
            legacySummary={caseData.ai_summary}
            legacyRecommendation={caseData.ai_recommendation}
            legacyRiskLevel={caseData.risk_level}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
            <p className="font-bold text-slate-800">Este caso ainda não tem análise da IA</p>
            <p className="mt-1 text-sm text-slate-500">Gere a análise para receber hipóteses, recomendações e próximos passos.</p>
            <button type="button" onClick={() => void generateAnalysis()} disabled={analysisBusy} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-leaf-600 px-5 text-sm font-bold text-white disabled:bg-slate-300">
              <IconSparkle className="h-4 w-4" /> {analysisBusy ? "Analisando as informações..." : "Gerar análise com IA"}
            </button>
          </div>
        )}
      </section>

      {/* Chat separado da análise inicial: conversar não altera a análise. */}
      <CaseChat
        key={caseId}
        caseId={caseId}
        initialMessages={(caseData.chat_messages ?? []) as unknown as ChatMessageRow[]}
        getAccessToken={getAccessToken}
      />

      {/* Anexos */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby={`attachments-title-${caseId}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 id={`attachments-title-${caseId}`} className="text-lg font-black text-slate-950">Fotos e anexos</h3>
          <span className="text-sm text-slate-500">{images.length} {images.length === 1 ? "foto" : "fotos"}</span>
        </div>
        {images.length ? (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {images.map((image, index) => (
              <li key={image.id}>
                <button type="button" onClick={() => setLightboxIndex(index)} className="block w-full overflow-hidden rounded-xl ring-1 ring-slate-200 hover:ring-leaf-400" aria-label={`Ampliar ${image.label.toLowerCase()} ${index + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- storage do Supabase */}
                  <img src={image.url} alt={image.label} loading="lazy" className="aspect-square w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Nenhuma foto anexada. Use “Editar caso” ou envie pelo chat.</p>
        )}
        {caseData.soil_analysis_url ? (
          <a href={caseData.soil_analysis_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-leaf-50 px-4 text-sm font-bold text-leaf-800 ring-1 ring-leaf-200">
            <IconDoc className="h-4 w-4" /> Análise de solo
          </a>
        ) : null}
      </section>

      {/* Histórico */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby={`history-title-${caseId}`}>
        <h3 id={`history-title-${caseId}`} className="text-lg font-black text-slate-950">Histórico do caso</h3>
        {(data?.analysisHistory ?? []).some((entry) => entry.previous) ? (
          <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">Análises anteriores da IA</summary>
            <ul className="mt-2 space-y-2">
              {(data?.analysisHistory ?? []).filter((entry) => entry.previous).map((entry) => (
                <li key={entry.id} className="rounded-lg bg-white p-3 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
                  <p className="text-xs font-bold text-slate-500">
                    Versão de {formatDate(entry.previous?.analyzedAt ?? null)} · substituída em {formatDate(entry.createdAt)}
                    {entry.previous?.riskLevel && LEVEL_LABELS[entry.previous.riskLevel as "low"] ? ` · risco ${LEVEL_LABELS[entry.previous.riskLevel as "low"].toLowerCase()}` : ""}
                  </p>
                  {entry.previous?.summary ? <p className="mt-1 line-clamp-4">{entry.previous.summary}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <ol className="mt-3 space-y-3">
          {activity.length ? (
            activity.slice(0, 30).map((log) => (
              <li key={log.id} className="flex gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-leaf-600 ring-4 ring-leaf-100" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{activityLabel(log)}</p>
                  <p className="text-xs text-slate-500">{formatDate(log.created_at)}</p>
                </div>
              </li>
            ))
          ) : (
            <li className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-leaf-600 ring-4 ring-leaf-100" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Caso criado</p>
                <p className="text-xs text-slate-500">{formatDate(caseData.created_at)}</p>
              </div>
            </li>
          )}
        </ol>
      </section>

      <ImageLightbox images={images} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndexChange={setLightboxIndex} />
      {editorOpen ? <CaseEditor caseData={caseData} getAccessToken={getAccessToken} onSaved={handleSaved} onClose={() => setEditorOpen(false)} /> : null}
    </div>
  );
}

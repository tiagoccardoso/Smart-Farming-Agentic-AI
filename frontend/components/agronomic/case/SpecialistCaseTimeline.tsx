"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgronomicPreAnalysis } from "../../../lib/agronomic/case";
import { buildSpecialistTimeline, decorateTimeline, type SpecialistTimelinePayload } from "../../../lib/agronomic/specialist-timeline";
import AnalysisAccordion from "./AnalysisAccordion";
import ImageLightbox from "./ImageLightbox";
import { IconRetry, IconSparkle, IconUser } from "./icons";

type TimelineResponse = SpecialistTimelinePayload & {
  case: SpecialistTimelinePayload["case"] & {
    ai_analysis_json: AgronomicPreAnalysis | null;
    ai_summary: string | null;
    ai_recommendation: string | null;
    risk_level: string | null;
  };
  images: Array<{ id: string; image_url: string; image_type: string | null; created_at: string | null }>;
  pendingQuestions: string[];
};

const STORAGE_PREFIX = "plantasa:painel-doutora:visto";

function readLastSeen(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLastSeen(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento local: só não haverá destaque de novidades.
  }
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

/**
 * Contexto completo do caso para a especialista, em ordem cronológica, com
 * destaque para o que chegou desde a última visita (por navegador) e depois da
 * solicitação do parecer. Somente leitura: não interfere no rascunho do parecer.
 */
export default function SpecialistCaseTimeline({ caseId, userId, getAccessToken }: { caseId: string; userId: string | null; getAccessToken: () => string | null }) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const markedRef = useRef<string | null>(null);
  const storageKey = `${STORAGE_PREFIX}:${userId ?? "anon"}:${caseId}`;

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setError("Sessão expirada. Faça login novamente.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/specialist/human-review-cases/${encodeURIComponent(caseId)}/timeline`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as (TimelineResponse & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "Não foi possível carregar o histórico do caso.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico do caso.");
    } finally {
      setLoading(false);
    }
  }, [caseId, getAccessToken]);

  useEffect(() => {
    setData(null);
    setOnlyNew(false);
    setLastSeenAt(readLastSeen(storageKey));
    void load();
  }, [load, storageKey]);

  // Registra a visita depois de exibir; o destaque desta sessão permanece.
  useEffect(() => {
    if (!data || markedRef.current === storageKey) return;
    markedRef.current = storageKey;
    writeLastSeen(storageKey, new Date().toISOString());
  }, [data, storageKey]);

  const entries = useMemo(() => (data ? decorateTimeline(buildSpecialistTimeline(data), { lastSeenAt, requestedAt: data.requestedAt }) : []), [data, lastSeenAt]);
  const newCount = entries.filter((entry) => entry.isNew).length;
  const visible = onlyNew ? entries.filter((entry) => entry.isNew) : entries;
  const chatImages = useMemo(
    () => entries.flatMap((entry) => (entry.kind === "chat" && entry.item.kind === "image" ? [{ id: entry.item.id, url: entry.item.url, label: "Foto enviada no chat" }] : [])),
    [entries],
  );

  if (loading && !data) return <p className="text-sm text-slate-500">Carregando histórico do caso...</p>;
  if (error && !data) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-red-600 px-4 font-semibold text-white"><IconRetry className="h-4 w-4" /> Tentar novamente</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4" data-testid="specialist-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {newCount > 0 ? (
          <p className="rounded-full bg-gold-100 px-3 py-1 text-xs font-bold text-gold-900">{newCount} {newCount === 1 ? "novidade" : "novidades"} desde sua última visita</p>
        ) : (
          <p className="text-xs text-slate-500">{lastSeenAt ? `Última visita: ${formatDate(lastSeenAt)}` : "Primeira visita a este caso neste navegador."}</p>
        )}
        <div className="flex gap-2">
          {newCount > 0 ? (
            <button type="button" onClick={() => setOnlyNew((value) => !value)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
              {onlyNew ? "Mostrar tudo" : "Só novidades"}
            </button>
          ) : null}
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <IconRetry className="h-3.5 w-3.5" /> Atualizar
          </button>
        </div>
      </div>

      <ol className="max-h-[560px] space-y-2.5 overflow-y-auto overscroll-contain rounded-2xl bg-slate-50 p-3">
        {visible.map((entry) => {
          const badges = (
            <span className="flex flex-wrap gap-1">
              {entry.isNew ? <span className="rounded-full bg-gold-300 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-gold-900">Novo</span> : null}
              {entry.afterRequest ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-sky-800">Após a solicitação</span> : null}
            </span>
          );
          if (entry.kind === "chat") {
            const item = entry.item;
            const mine = item.role === "user";
            return (
              <li key={entry.id} className={`rounded-xl p-3 text-sm leading-6 ring-1 ${entry.isNew ? "ring-gold-300" : "ring-slate-200"} ${mine ? "bg-white" : "bg-leaf-50/60"}`}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-bold">
                    {mine ? <IconUser className="h-3.5 w-3.5" /> : <IconSparkle className="h-3.5 w-3.5" />}
                    {mine ? "Produtor" : "IA"} · {formatDate(entry.at)}
                  </span>
                  {badges}
                </div>
                {item.kind === "text" ? <p className="whitespace-pre-wrap text-slate-800">{item.text}</p> : null}
                {item.kind === "image" ? (
                  <button type="button" onClick={() => setLightboxIndex(chatImages.findIndex((image) => image.id === item.id))} className="block overflow-hidden rounded-lg" aria-label="Ampliar foto enviada no chat">
                    {/* eslint-disable-next-line @next/next/no-img-element -- storage do Supabase */}
                    <img src={item.url} alt="Foto enviada no chat" loading="lazy" className="h-36 w-48 object-cover" />
                  </button>
                ) : null}
                {item.kind === "audio" ? (
                  <div className="space-y-1.5">
                    {item.url ? <audio controls preload="metadata" src={item.url} className="w-full max-w-xs"><track kind="captions" /></audio> : null}
                    <p className="text-slate-700">{item.transcription ? <><strong>Transcrição:</strong> {item.transcription}</> : <span className="text-xs text-slate-500">Sem transcrição automática. Ouça o áudio original.</span>}</p>
                  </div>
                ) : null}
              </li>
            );
          }
          const tone = entry.kind === "request" ? "border-sky-200 bg-sky-50" : entry.kind === "review" ? "border-moss-200 bg-moss-50" : entry.kind === "analysis" ? "border-slate-200 bg-white" : "border-gold-200 bg-gold-50/60";
          return (
            <li key={entry.id} className={`rounded-xl border px-3 py-2 text-sm ${tone}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{entry.title}</span>
                {badges}
              </div>
              <p className="text-xs text-slate-500">{formatDate(entry.at)}{entry.kind === "update" && entry.detail ? ` · ${entry.detail}` : ""}</p>
            </li>
          );
        })}
        {!visible.length ? <li className="text-sm text-slate-500">Nenhum registro.</li> : null}
      </ol>

      {data.case.ai_analysis_json || data.case.ai_summary ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Análise atual da IA (completa, com fontes)</summary>
          <div className="mt-3">
            <AnalysisAccordion
              analysis={data.case.ai_analysis_json}
              reportedSymptoms={data.case.symptoms}
              pendingQuestions={data.pendingQuestions}
              legacySummary={data.case.ai_summary}
              legacyRecommendation={data.case.ai_recommendation}
              legacyRiskLevel={data.case.risk_level}
            />
          </div>
        </details>
      ) : null}

      <ImageLightbox images={chatImages} index={lightboxIndex !== null && lightboxIndex >= 0 ? lightboxIndex : null} onClose={() => setLightboxIndex(null)} onIndexChange={setLightboxIndex} />
    </div>
  );
}

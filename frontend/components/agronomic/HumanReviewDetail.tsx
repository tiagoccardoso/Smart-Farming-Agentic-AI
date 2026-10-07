"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { AgronomicCase } from "../../lib/agronomic/case";
import {
  REVIEW_STAGE_INFO,
  type ClientHumanReview,
  type ClientReviewStage,
  type TimelineStep,
  toTextBlocks,
} from "../../lib/agronomic/client-review";
import { RiskBadge, StatusBadge } from "./StatusBadge";

/**
 * Blocos de apresentação da tela Revisão Humana (visão do produtor).
 * Separam visualmente: status da revisão, parecer do agrônomo, análise
 * inicial automatizada, informações originais do caso e linha do tempo.
 */

export type CaseReport = { id: string; report_url: string | null; report_type: string | null; created_at: string | null };
export type ActivityLog = { id: string; action: string; metadata: Record<string, unknown> | null; created_at: string | null };

export function formatDateTime(value?: string | null) {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatLongDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Texto livre em parágrafos e listas, preservando todo o conteúdo. */
export function RichText({ text, className = "" }: { text?: string | null; className?: string }) {
  const blocks = toTextBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className={`space-y-3 text-[15px] leading-7 text-slate-800 ${className}`}>
      {blocks.map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index} className="whitespace-pre-line break-words">{block.text}</p>
        ) : (
          <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-leaf-600">
            {block.items.map((item, itemIndex) => <li key={itemIndex} className="break-words pl-1">{item}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}

const stageIcon: Record<ClientReviewStage, string> = {
  not_requested: "•",
  pending_payment: "!",
  waiting_review: "⏳",
  in_review: "🔎",
  completed: "✓",
  cancelled: "✕",
  rejected: "✕",
};

const stagePanelStyle: Record<ClientReviewStage, string> = {
  not_requested: "border-slate-200 bg-slate-50 text-slate-900",
  pending_payment: "border-amber-200 bg-amber-50 text-amber-950",
  waiting_review: "border-purple-200 bg-purple-50 text-purple-950",
  in_review: "border-indigo-200 bg-indigo-50 text-indigo-950",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-950",
  cancelled: "border-slate-200 bg-slate-50 text-slate-900",
  rejected: "border-red-200 bg-red-50 text-red-950",
};

/** Painel "Status da revisão": o estado atual em linguagem simples. */
export function ReviewStatusPanel({ stage, children }: { stage: ClientReviewStage; children?: ReactNode }) {
  const info = REVIEW_STAGE_INFO[stage];
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${stagePanelStyle[stage]}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80 text-base font-black shadow-soft">{stageIcon[stage]}</span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide opacity-70">Status da revisão</p>
          <p className="mt-1 text-base font-black sm:text-lg">{info.title}</p>
          <p className="mt-1 text-sm leading-6 opacity-90">{info.description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function OpinionSection({ title, hint, children, tone = "default" }: { title: string; hint?: string; children: ReactNode; tone?: "default" | "highlight" | "attention" }) {
  const toneClass =
    tone === "highlight"
      ? "border-leaf-200 bg-leaf-50/70"
      : tone === "attention"
        ? "border-gold-200 bg-gold-50"
        : "border-slate-100 bg-white";
  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${toneClass}`}>
      <h4 className="text-sm font-black uppercase tracking-wide text-moss-800">{title}</h4>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Destaque principal da tela quando o parecer está concluído.
 * Ordem de leitura: quem/quando → conclusão → recomendações → observações.
 */
export function AgronomistOpinionCard({ review, isNew, report }: { review: ClientHumanReview; isNew: boolean; report?: CaseReport | null }) {
  const concludedAt = formatLongDate(review.reviewedAt);
  return (
    <article id="parecer-agronomo" aria-labelledby="parecer-agronomo-titulo" className="overflow-hidden rounded-3xl border-2 border-emerald-300 bg-white shadow-soft">
      <header className="bg-gradient-to-br from-leaf-800 to-emerald-700 p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-800">✓ Revisão concluída</span>
          {isNew && <span className="inline-flex rounded-full bg-gold-300 px-3 py-1 text-xs font-black text-gold-900">Novo</span>}
        </div>
        <h3 id="parecer-agronomo-titulo" className="mt-3 text-2xl font-black sm:text-3xl">Parecer do Agrônomo</h3>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-2xl bg-white/10 p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-leaf-100">Profissional responsável</dt>
            <dd className="mt-1 font-bold">{review.specialistName || "Especialista PlantaSa"}</dd>
          </div>
          <div className="rounded-2xl bg-white/10 p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-leaf-100">Concluído em</dt>
            <dd className="mt-1 font-bold">{concludedAt ?? "Data não registrada"}</dd>
          </div>
        </dl>
      </header>

      <div className="space-y-4 p-4 sm:p-6">
        <OpinionSection title="Conclusão do parecer" hint="Interpretação técnica do profissional sobre o caso." tone="highlight">
          {review.reviewText ? <RichText text={review.reviewText} /> : <p className="text-sm text-slate-500">Conclusão não registrada.</p>}
        </OpinionSection>

        <OpinionSection title="Recomendações e próximos passos" hint="O que fazer a partir de agora, segundo o agrônomo.">
          {review.technicalRecommendation ? <RichText text={review.technicalRecommendation} /> : <p className="text-sm text-slate-500">Nenhuma recomendação registrada.</p>}
        </OpinionSection>

        {review.finalObservations && (
          <OpinionSection title="Observações e ressalvas" hint="Limites da análise remota, alertas e pendências." tone="attention">
            <RichText text={review.finalObservations} />
          </OpinionSection>
        )}

        {report && (
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-slate-900">Relatório final</p>
              <p className="text-xs text-slate-600">{report.report_url ? "Documento disponível para download." : "Em preparação. Ficará disponível aqui quando concluído."}</p>
            </div>
            {report.report_url && (
              <a href={report.report_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-leaf-700 px-5 py-2.5 text-center text-sm font-black text-white hover:bg-leaf-800">Baixar relatório</a>
            )}
          </div>
        )}

        <p className="text-xs leading-5 text-slate-500">Este parecer foi emitido por profissional com base nas informações e imagens enviadas. Em caso de agravamento dos sintomas, envie novas imagens ou fale com a equipe.</p>
      </div>
    </article>
  );
}

/** Lugar reservado do parecer enquanto a revisão está em andamento. */
export function OpinionPendingCard({ stage, requestedAt }: { stage: ClientReviewStage; requestedAt?: string | null }) {
  return (
    <section aria-labelledby="parecer-pendente-titulo" className="rounded-3xl border-2 border-dashed border-purple-200 bg-white p-5 shadow-soft sm:p-6">
      <h3 id="parecer-pendente-titulo" className="text-lg font-black text-slate-950">Parecer do Agrônomo</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {stage === "in_review" ? "O profissional já iniciou a análise. As conclusões e recomendações aparecerão aqui quando o parecer for concluído." : "Seu caso está na fila. As conclusões e recomendações aparecerão aqui quando o parecer for concluído."}
      </p>
      {requestedAt && <p className="mt-3 text-xs font-semibold text-slate-500">Enviado para revisão em {formatDateTime(requestedAt)}</p>}
    </section>
  );
}

const stepStyle: Record<TimelineStep["state"], { dot: string; icon: string; text: string }> = {
  done: { dot: "bg-emerald-600 text-white", icon: "✓", text: "text-slate-900" },
  current: { dot: "bg-indigo-600 text-white ring-4 ring-indigo-100", icon: "•", text: "text-indigo-900" },
  upcoming: { dot: "border-2 border-slate-200 bg-white text-slate-300", icon: "", text: "text-slate-500" },
  stopped: { dot: "bg-red-100 text-red-700", icon: "✕", text: "text-red-800" },
};

const stepStateLabel: Record<TimelineStep["state"], string> = {
  done: "concluído",
  current: "etapa atual",
  upcoming: "pendente",
  stopped: "interrompido",
};

export function ReviewTimeline({ steps, logs }: { steps: TimelineStep[]; logs: ActivityLog[] }) {
  return (
    <section aria-labelledby="andamento-titulo" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
      <h3 id="andamento-titulo" className="text-lg font-black text-slate-950">Andamento</h3>
      <ol className="mt-5">
        {steps.map((step, index) => {
          const style = stepStyle[step.state];
          const isLast = index === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast && <span aria-hidden className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${step.state === "done" ? "bg-emerald-200" : "bg-slate-100"}`} />}
              <span aria-hidden className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${style.dot}`}>{style.icon}</span>
              <div className="min-w-0 pt-0.5">
                <p className={`text-sm font-bold ${style.text}`}>
                  {step.label}
                  <span className="sr-only"> ({stepStateLabel[step.state]})</span>
                </p>
                {step.date && <p className="text-xs text-slate-500">{formatDateTime(step.date)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {logs.length > 0 && (
        <details className="mt-5 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">Histórico de atividades ({logs.length})</summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            {logs.slice(-10).map((log) => <li key={log.id}>{formatDateTime(log.created_at)} — {log.action}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Análise inicial automatizada. Quando há parecer concluído fica recolhida e
 * claramente rotulada como anterior ao parecer, com comparação lado a lado.
 */
export function InitialAnalysisSection({ caseData, review, hasOpinion }: { caseData: AgronomicCase; review?: ClientHumanReview | null; hasOpinion: boolean }) {
  const hasAi = Boolean(caseData.ai_summary || caseData.ai_recommendation);
  const content = (
    <div className="space-y-4">
      {hasOpinion && review && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Antes · Orientação automatizada</p>
            <RichText className="mt-2 text-sm leading-6 text-slate-700" text={caseData.ai_recommendation || caseData.ai_summary || "Sem orientação registrada."} />
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Depois · Recomendação do agrônomo</p>
            <RichText className="mt-2 text-sm leading-6 text-emerald-950" text={review.technicalRecommendation || "Sem recomendação registrada."} />
          </div>
          <p className="text-xs leading-5 text-slate-500 md:col-span-2">Em caso de divergência, prevalece o parecer do agrônomo.</p>
        </div>
      )}
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">Resumo da análise inicial</p>
        <RichText className="mt-2 text-sm leading-6 text-slate-700" text={caseData.ai_summary || "Análise inicial ainda não disponível."} />
      </div>
      {caseData.ai_recommendation && (
        <div className="rounded-2xl bg-leaf-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-leaf-800">Orientação inicial</p>
          <RichText className="mt-2 text-sm leading-6 text-leaf-900" text={caseData.ai_recommendation} />
        </div>
      )}
    </div>
  );

  if (!hasAi) return null;

  if (hasOpinion) {
    return (
      <details className="group rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
          <span>
            <span className="block text-lg font-black text-slate-950">Análise inicial automatizada</span>
            <span className="mt-1 block text-sm text-slate-600">Triagem feita antes da revisão humana. Compare com o parecer do agrônomo.</span>
          </span>
          <span aria-hidden className="mt-1 shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600 group-open:hidden">Ver</span>
          <span aria-hidden className="mt-1 hidden shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600 group-open:inline">Ocultar</span>
        </summary>
        <div className="mt-5">{content}</div>
      </details>
    );
  }

  return (
    <section aria-labelledby="analise-inicial-titulo" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="analise-inicial-titulo" className="text-lg font-black text-slate-950">Análise inicial automatizada</h3>
        <StatusBadge status="ai_analyzed" label="Sem revisão humana" />
      </div>
      <p className="mt-1 text-sm text-slate-600">Orientação preliminar. Não substitui o parecer de um profissional.</p>
      <div className="mt-4">{content}</div>
    </section>
  );
}

/** Informações enviadas pelo produtor (dados originais do caso). */
export function CaseOriginalInfo({ caseData, actions }: { caseData: AgronomicCase; actions?: ReactNode }) {
  const location = [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/");
  const answered = caseData.pending_questions?.filter((question) => question.status === "answered") ?? [];
  return (
    <details className="group rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span>
          <span className="block text-lg font-black text-slate-950">Informações enviadas</span>
          <span className="mt-1 block text-sm text-slate-600">Sintomas, propriedade, imagens, respostas e conversa.</span>
        </span>
        <span aria-hidden className="mt-1 shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600 group-open:hidden">Ver</span>
        <span aria-hidden className="mt-1 hidden shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-600 group-open:inline">Ocultar</span>
      </summary>
      <div className="mt-5 space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Cultura</dt><dd className="mt-1 font-semibold text-slate-900">{caseData.crop}</dd></div>
          <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Estádio</dt><dd className="mt-1 font-semibold text-slate-900">{caseData.growth_stage || "Não informado"}</dd></div>
          <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Propriedade</dt><dd className="mt-1 font-semibold text-slate-900">{[caseData.farm?.name, location].filter(Boolean).join(" · ") || "Não informada"}</dd></div>
          <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Risco estimado</dt><dd className="mt-1"><RiskBadge riskLevel={caseData.risk_level} /></dd></div>
        </dl>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sintomas relatados</p>
          <RichText className="mt-1 text-sm leading-6 text-slate-700" text={caseData.symptoms || "Não informados."} />
        </div>
        {caseData.history && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Histórico de manejo</p>
            <RichText className="mt-1 text-sm leading-6 text-slate-700" text={caseData.history} />
          </div>
        )}
        {answered.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Perguntas respondidas ({answered.length})</p>
            <div className="mt-2 space-y-2">
              {answered.map((question) => (
                <div key={question.id} className="rounded-2xl bg-slate-50 p-3">
                  <p className="font-bold text-slate-900">{question.question}</p>
                  <p className="mt-1 text-slate-600">{question.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {caseData.images.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Imagens ({caseData.images.length})</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {caseData.images.slice(0, 9).map((image) => (
                <a key={image.id} href={image.image_url} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                  <Image src={image.image_url} alt={`Imagem do caso enviada em ${formatDateTime(image.created_at)}`} width={220} height={120} unoptimized className="h-24 w-full object-cover" />
                  <span className="block px-2 py-1.5 text-[11px] font-semibold text-leaf-700">{formatDateTime(image.created_at)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {(caseData.chat_messages?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Conversa recente com a IA</p>
            <div className="mt-2 space-y-2">
              {caseData.chat_messages?.slice(-6).map((message) => (
                <div key={message.id} className="rounded-2xl bg-slate-50 p-3">
                  <strong>{message.role === "assistant" ? "IA" : "Você"}:</strong> {message.message_type === "audio" ? "Áudio anexado" : message.message}
                </div>
              ))}
            </div>
          </div>
        )}
        {actions}
      </div>
    </details>
  );
}

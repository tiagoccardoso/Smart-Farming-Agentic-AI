"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import { getAgronomicCases } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicFarm, AgronomicRiskLevel } from "../../lib/agronomic/case";

type ReportFilter = "all" | "in_analysis" | "waiting_human_review" | "reviewed" | "completed";

type HumanReviewSummary = {
  id: string;
  case_id: string;
  status: string | null;
  review_text: string | null;
  technical_recommendation: string | null;
  final_observations: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

type ReportSummary = {
  id: string;
  case_id: string;
  report_url: string | null;
  report_type: string | null;
  created_at: string | null;
};

type ReportCase = {
  id: string;
  crop: string;
  status: string | null;
  risk_level: AgronomicRiskLevel | null;
  ai_summary: string | null;
  ai_recommendation: string | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  created_at: string | null;
  farm: AgronomicFarm | null;
  latestHumanReview: HumanReviewSummary | null;
  latestReport: ReportSummary | null;
};

const filters: Array<{ key: ReportFilter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "in_analysis", label: "Em análise" },
  { key: "waiting_human_review", label: "Aguardando revisão humana" },
  { key: "reviewed", label: "Revisado" },
  { key: "completed", label: "Concluído" }
];

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  ai_analyzed: "Pré-análise da IA",
  waiting_human_review: "Aguardando revisão humana",
  human_reviewed: "Revisado",
  completed: "Concluído"
};

const humanReviewStatusLabels: Record<string, string> = {
  not_requested: "Não solicitada",
  pending_payment: "Pagamento pendente",
  pending: "Pendente",
  waiting_review: "Aguardando especialista",
  in_review: "Em revisão",
  reviewed: "Revisada",
  completed: "Concluída",
  rejected: "Recusada"
};

function formatDate(value: string | null) {
  if (!value) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function getFarmLabel(farm: AgronomicFarm | null) {
  if (!farm) {
    return "Propriedade não informada";
  }

  const location = [farm.city, farm.state].filter(Boolean).join("/");
  return [farm.name || "Propriedade sem nome", location].filter(Boolean).join(" • ");
}

function getStatusLabel(status: string | null) {
  if (!status) {
    return "Sem status";
  }

  return statusLabels[status] ?? status.replace(/_/g, " ");
}

function getHumanReviewStatusLabel(status: string | null) {
  if (!status) {
    return "Não solicitada";
  }

  return humanReviewStatusLabels[status] ?? status.replace(/_/g, " ");
}

function hasCompletedHumanReview(caseItem: ReportCase) {
  return Boolean(
    caseItem.latestHumanReview ||
      ["reviewed", "completed"].includes(caseItem.human_review_status ?? "") ||
      ["human_reviewed", "completed"].includes(caseItem.status ?? "")
  );
}

function isWaitingHumanReview(caseItem: ReportCase) {
  return Boolean(
    caseItem.human_review_requested &&
      ["pending_payment", "pending", "waiting_review", "in_review"].includes(caseItem.human_review_status ?? "")
  );
}

function matchesFilter(caseItem: ReportCase, filter: ReportFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "in_analysis") {
    return ["submitted", "ai_analyzed"].includes(caseItem.status ?? "") && !isWaitingHumanReview(caseItem) && !hasCompletedHumanReview(caseItem);
  }

  if (filter === "waiting_human_review") {
    return isWaitingHumanReview(caseItem);
  }

  if (filter === "reviewed") {
    return hasCompletedHumanReview(caseItem) && caseItem.status !== "completed";
  }

  return caseItem.status === "completed";
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

function EmptyState({ hasCases }: { hasCases: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-leaf-200 bg-white p-8 text-center shadow-soft md:p-12">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf-50 text-2xl" aria-hidden>
        📋
      </div>
      <h3 className="mt-5 text-xl font-semibold text-slate-900">
        {hasCases ? "Nenhum caso encontrado para este filtro." : "Você ainda não enviou nenhum caso agronômico."}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {hasCases
          ? "Altere o filtro para visualizar outros estágios de análise, revisão humana ou conclusão."
          : "Envie sintomas, cultura, propriedade e anexos para iniciar a pré-análise com IA e acompanhar tudo por aqui."}
      </p>
      {!hasCases && (
        <Link href="/enviar-caso" className="mt-6 inline-flex rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
          Enviar meu primeiro caso
        </Link>
      )}
    </div>
  );
}

function CaseCard({ caseItem }: { caseItem: ReportCase }) {
  const riskLevel = caseItem.risk_level;
  const hasHumanReview = hasCompletedHumanReview(caseItem);
  const hasPdfReport = Boolean(caseItem.latestReport?.report_url);
  const reportInPreparation = Boolean(caseItem.latestReport && !caseItem.latestReport.report_url);
  const reportResponsibilityLabel = hasHumanReview
    ? "Relatório revisado por especialista habilitado."
    : "Orientação inicial automatizada, sem revisão humana.";

  return (
    <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={caseItem.status} label={getStatusLabel(caseItem.status)} />
            <RiskBadge riskLevel={riskLevel} />
          </div>
          <h3 className="mt-4 text-2xl font-semibold text-slate-900">{caseItem.crop || "Cultura não informada"}</h3>
          <div className={`mt-4 rounded-2xl border p-4 text-sm leading-6 ${hasHumanReview ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <p className="font-semibold">{reportResponsibilityLabel}</p>
            {!hasHumanReview && <p className="mt-1">Solicite revisão humana antes de usar este conteúdo como base para decisões técnicas, defensivos ou recomendações com responsabilidade profissional.</p>}
          </div>
          <dl className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-semibold text-slate-900">Propriedade</dt>
              <dd className="mt-1">{getFarmLabel(caseItem.farm)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Data</dt>
              <dd className="mt-1">{formatDate(caseItem.created_at)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Revisão humana</dt>
              <dd className="mt-1">{hasHumanReview ? "Possui revisão" : getHumanReviewStatusLabel(caseItem.human_review_status)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Relatório PDF</dt>
              <dd className="mt-1">{hasPdfReport ? "Disponível" : reportInPreparation ? "Em preparação" : "Não disponível"}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
        <Link href={`/consultoria-ia?caseId=${encodeURIComponent(caseItem.id)}`} className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
          Abrir análise IA
        </Link>
        <Link href={`/revisao-humana?caseId=${encodeURIComponent(caseItem.id)}`} className="rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-semibold text-leaf-700 shadow-soft hover:border-leaf-300">
          Pagar revisão humana
        </Link>
        {hasHumanReview ? (
          <Link href={`#revisao-${caseItem.id}`} className="rounded-full border border-slate-200 bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-700">
            Ver parecer humano
          </Link>
        ) : (
          <button type="button" disabled className="rounded-full border border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-400">
            Ver parecer humano
          </button>
        )}
        {hasPdfReport ? (
          <a href={caseItem.latestReport?.report_url ?? "#"} download className="rounded-full border border-sun-200 bg-sun-50 px-5 py-3 text-sm font-semibold text-sun-800 shadow-soft hover:bg-sun-100">
            Baixar relatório final
          </a>
        ) : (
          <button type="button" disabled className="rounded-full border border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-400">
            Baixar relatório final
          </button>
        )}
      </div>

      {caseItem.latestHumanReview && (
        <div id={`revisao-${caseItem.id}`} className="mt-6 rounded-2xl border border-leaf-100 bg-leaf-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold text-slate-900">Revisão humana mais recente</h4>
            <p className="basis-full text-sm leading-6 text-leaf-900">Este relatório foi revisado por especialista e complementa a triagem automatizada inicial.</p>
            <Pill className="bg-white text-leaf-700">{getHumanReviewStatusLabel(caseItem.latestHumanReview.status)}</Pill>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parecer técnico</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{caseItem.latestHumanReview.review_text ?? "Parecer ainda não registrado."}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recomendação técnica</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{caseItem.latestHumanReview.technical_recommendation ?? "Recomendação ainda não registrada."}</p>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function MeusRelatoriosPage() {
  const [cases, setCases] = useState<ReportCase[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ReportFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCases() {
      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setError("Faça login com Supabase para acompanhar seus relatórios.");
        setLoading(false);
        return;
      }

      try {
        const response = (await getAgronomicCases(accessToken)) as { cases: ReportCase[] };
        setCases(response.cases ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar seus casos.");
      } finally {
        setLoading(false);
      }
    }

    loadCases();
  }, []);

  const filteredCases = useMemo(() => cases.filter((caseItem) => matchesFilter(caseItem, selectedFilter)), [cases, selectedFilter]);

  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Histórico do produtor
        </p>
        <SectionTitle title="Meus Relatórios" subtitle="Acompanhe seus casos, pré-análises da IA, revisões humanas e relatórios." />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Veja o andamento de cada caso agronômico enviado, filtre por etapa e acesse rapidamente a análise da IA, a solicitação de revisão humana e o download do relatório quando estiver disponível.
        </p>
        <SafetyDisclaimer className="mt-5 max-w-3xl bg-white/90" />
      </div>

      <WorkflowStepper
        className="mt-8"
        steps={[
          { title: "Enviar caso", description: "Cultura, sintomas, histórico e anexos.", href: "/enviar-caso", status: cases.length > 0 ? "done" : "next" },
          { title: "Consultoria IA", description: "Pré-análise e badge de risco.", href: "/consultoria-ia", status: cases.some((caseItem) => caseItem.ai_summary) ? "done" : "next" },
          { title: "Revisão humana", description: "Pagamento e fila da especialista.", href: "/revisao-humana", status: cases.some((caseItem) => caseItem.human_review_requested) ? "done" : "next" },
          { title: "Relatório final", description: "Parecer da Doutora e download.", status: cases.some((caseItem) => caseItem.latestHumanReview || caseItem.latestReport) ? "current" : "next" }
        ]}
      />

      <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setSelectedFilter(filter.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                selectedFilter === filter.key ? "bg-leaf-600 text-white shadow-soft" : "bg-leaf-50 text-leaf-700 hover:bg-leaf-100"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-soft">{error}</div>}
      {loading && <div className="mt-8"><LoadingCard title="Carregando seus relatórios" description="Buscando casos, revisões humanas e arquivos finais vinculados à sua conta." rows={4} /></div>}

      {!loading && !error && (
        <div className="mt-8 space-y-5">
          {filteredCases.length > 0 ? filteredCases.map((caseItem) => <CaseCard key={caseItem.id} caseItem={caseItem} />) : <EmptyState hasCases={cases.length > 0} />}
        </div>
      )}
    </section>
  );
}

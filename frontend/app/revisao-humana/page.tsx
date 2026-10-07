"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import {
  type ActivityLog,
  AgronomistOpinionCard,
  type CaseReport,
  CaseOriginalInfo,
  InitialAnalysisSection,
  OpinionPendingCard,
  ReviewStatusPanel,
  ReviewTimeline,
  formatDateTime,
} from "../../components/agronomic/HumanReviewDetail";
import { deleteAgronomicCase, getAgronomicCase } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase } from "../../lib/agronomic/case";
import {
  REVIEW_STAGE_INFO,
  type ClientHumanReview,
  type ClientReviewStage,
  type SeenOpinions,
  buildReviewTimeline,
  getClientReviewStage,
  isOpinionUnseen,
  isReviewInProgress,
  markOpinionSeen,
  parseSeenOpinions,
} from "../../lib/agronomic/client-review";

type HumanReviewListCase = AgronomicCase & {
  images_count?: number;
  payment_status?: string | null;
  review_price_cents?: number | null;
  latestOrder?: { id: string; payment_status: string | null; price_cents: number | null } | null;
  latestReport?: CaseReport | null;
  latestHumanReview?: { id: string; status: string | null; reviewed_at: string | null; created_at: string | null } | null;
};

type DetailPayload = { case: AgronomicCase; activityLogs?: ActivityLog[]; humanReview?: ClientHumanReview | null; latestReport?: CaseReport | null };
type FilterKey = "all" | "completed" | "in_review" | "waiting_review" | "pending_payment" | "cancelled";

const filterLabels: Record<FilterKey, string> = {
  all: "Todos",
  completed: "Parecer concluído",
  in_review: "Em análise",
  waiting_review: "Aguardando revisão",
  pending_payment: "Pagamento pendente",
  cancelled: "Cancelados",
};

const filterStages: Record<Exclude<FilterKey, "all">, ClientReviewStage[]> = {
  completed: ["completed"],
  in_review: ["in_review"],
  waiting_review: ["waiting_review"],
  pending_payment: ["pending_payment"],
  cancelled: ["cancelled", "rejected", "not_requested"],
};

const paymentStatusLabels: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  canceled: "Cancelado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

/** Registro local (por navegador) dos pareceres já abertos, para o aviso "Novo". */
const SEEN_STORAGE_KEY = "plantasa:revisao-humana:pareceres-vistos";

function readSeenOpinions(): SeenOpinions {
  try {
    return parseSeenOpinions(window.localStorage.getItem(SEEN_STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeSeenOpinions(seen: SeenOpinions) {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Sem armazenamento local: o indicador "Novo" apenas não é persistido.
  }
}

function summarize(value?: string | null, limit = 150) {
  const clean = value?.trim();
  if (!clean) return "Sem resumo registrado.";
  return clean.length > limit ? `${clean.slice(0, limit).trim()}...` : clean;
}

/**
 * Casos antigos têm pedido avulso (pago/pendente). Casos novos usam o parecer
 * incluído no plano e não possuem pedido: exibimos "Incluído no plano".
 */
function getPaymentStatus(caseItem: HumanReviewListCase) {
  return caseItem.payment_status || caseItem.latestOrder?.payment_status || (caseItem.human_review_status === "pending_payment" ? "pending" : "included");
}

function caseHref(caseId: string) {
  return `/revisao-humana?caseId=${encodeURIComponent(caseId)}`;
}

function SummaryTile({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-soft ${highlight ? "border-emerald-200 bg-emerald-50" : "border-slate-100 bg-white"}`}>
      <p className={`text-xs font-bold uppercase tracking-wide ${highlight ? "text-emerald-700" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-2 text-2xl font-black ${highlight ? "text-emerald-900" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function RevisaoHumanaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCaseId = searchParams.get("caseId") ?? "";
  const checkoutStatus = searchParams.get("payment");
  const [cases, setCases] = useState<HumanReviewListCase[]>([]);
  const [aiCases, setAiCases] = useState<HumanReviewListCase[]>([]);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showLocator, setShowLocator] = useState(false);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<HumanReviewListCase | AgronomicCase | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<SeenOpinions>({});
  const [openedAsNew, setOpenedAsNew] = useState(false);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => { setSeen(readSeenOpinions()); }, []);

  const loadDashboard = useCallback(async () => {
    const token = getStoredSupabaseAccessToken();
    if (!token) {
      setError("Faça login para acompanhar revisões humanas.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const load = (scope: string) => fetch(`/api/agronomic-cases?scope=${scope}&limit=100`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json().then((payload) => (response.ok ? payload : Promise.reject(new Error(payload?.error || "Falha ao carregar casos.")))));
      const [reviewPayload, analyzedPayload] = await Promise.all([load("human_review"), load("ai_analyzed")]);
      setCases(reviewPayload.cases ?? []);
      setAiCases(analyzedPayload.cases ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o painel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    if (checkoutStatus === "success") setToast("Pagamento recebido/iniciado. O painel será atualizado assim que o Stripe confirmar o webhook.");
    if (checkoutStatus === "cancelled") setToast("Checkout cancelado. O caso continua salvo para você retomar o pagamento depois.");
  }, [checkoutStatus]);

  useEffect(() => {
    let active = true;
    async function loadDetail() {
      setDetailError(null);
      if (!selectedCaseId) {
        setDetail(null);
        return;
      }
      const token = getStoredSupabaseAccessToken();
      if (!token) return;
      setLoadingDetail(true);
      try {
        const payload = (await getAgronomicCase(selectedCaseId, token)) as DetailPayload;
        if (!active) return;
        setDetail(payload);
        const stage = getClientReviewStage(payload.case);
        const reviewedAt = payload.humanReview?.reviewedAt ?? null;
        if (stage === "completed" && payload.humanReview?.reviewText) {
          const current = readSeenOpinions();
          setOpenedAsNew(isOpinionUnseen(selectedCaseId, reviewedAt, current));
          const next = markOpinionSeen(current, selectedCaseId, reviewedAt);
          writeSeenOpinions(next);
          setSeen(next);
        } else {
          setOpenedAsNew(false);
        }
      } catch (detailLoadError) {
        if (!active) return;
        setDetail(null);
        setDetailError(detailLoadError instanceof Error ? detailLoadError.message : "Não foi possível abrir o caso.");
      } finally {
        if (active) setLoadingDetail(false);
      }
    }
    loadDetail();
    return () => { active = false; };
  }, [selectedCaseId, detailReload]);

  // Em telas sem a coluna lateral (mobile/tablet), leva o usuário ao detalhe.
  useEffect(() => {
    if (!selectedCaseId || !detail || loadingDetail) return;
    if (window.matchMedia("(max-width: 1279px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedCaseId, detail, loadingDetail]);

  const casesWithStage = useMemo(() => cases.map((caseItem) => {
    const stage = getClientReviewStage(caseItem);
    const reviewedAt = caseItem.latestHumanReview?.reviewed_at ?? null;
    return { caseItem, stage, isNew: stage === "completed" && caseItem.latestHumanReview?.status === "completed" && isOpinionUnseen(caseItem.id, reviewedAt, seen) };
  }), [cases, seen]);

  const counts = useMemo(() => {
    const byStage = (stages: ClientReviewStage[]) => casesWithStage.filter((item) => stages.includes(item.stage)).length;
    return {
      all: casesWithStage.length,
      completed: byStage(filterStages.completed),
      in_review: byStage(filterStages.in_review),
      waiting_review: byStage(filterStages.waiting_review),
      pending_payment: byStage(filterStages.pending_payment),
      cancelled: byStage(filterStages.cancelled),
      unseen: casesWithStage.filter((item) => item.isNew).length,
      reports: cases.filter((caseItem) => Boolean(caseItem.latestReport?.report_url)).length,
    } satisfies Record<FilterKey | "unseen" | "reports", number>;
  }, [casesWithStage, cases]);

  const visibleFilters = (Object.keys(filterLabels) as FilterKey[]).filter((key) => key === "all" || key === filter || counts[key] > 0);

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return casesWithStage
      .filter(({ caseItem, stage }) => {
        const matchesFilter = filter === "all" || filterStages[filter].includes(stage);
        const haystack = `${caseItem.id} ${caseItem.crop} ${caseItem.farm?.name ?? ""} ${caseItem.ai_summary ?? ""}`.toLowerCase();
        return matchesFilter && (!needle || haystack.includes(needle));
      })
      // Pareceres novos primeiro; o restante mantém a ordem por atualização.
      .sort((a, b) => Number(b.isNew) - Number(a.isNew));
  }, [casesWithStage, filter, search]);

  const firstUnseen = casesWithStage.find((item) => item.isNew);

  function openCase(caseId: string) {
    router.push(caseHref(caseId), { scroll: false });
  }

  async function requestReview(caseId: string) {
    const token = getStoredSupabaseAccessToken();
    if (!token) return setError("Faça login para enviar um caso à revisão humana.");
    setBusyCaseId(caseId);
    setError(null);
    try {
      const response = await fetch("/api/agronomic-cases/request-human-review", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ caseId }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível enviar o caso.");
      setToast(payload?.humanOpinion?.balanceLabel ? `Caso enviado para parecer agronômico. ${payload.humanOpinion.balanceLabel}.` : "Caso enviado para parecer agronômico da especialista.");
      setShowLocator(false);
      await loadDashboard();
      if (caseId === selectedCaseId) setDetailReload((value) => value + 1);
      else openCase(caseId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível enviar o caso.");
    } finally {
      setBusyCaseId(null);
    }
  }

  async function cancelReview(caseId: string) {
    const token = getStoredSupabaseAccessToken();
    if (!token) return;
    setBusyCaseId(caseId);
    setError(null);
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}/human-review`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível cancelar.");
      setToast("Solicitação cancelada. O caso analisado pela IA continua disponível para novo envio.");
      await loadDashboard();
      router.push("/revisao-humana", { scroll: false });
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Não foi possível cancelar.");
    } finally {
      setBusyCaseId(null);
    }
  }

  async function confirmDeleteCase() {
    if (!deleteCandidate || deleteConfirmation !== "EXCLUIR") return;
    const token = getStoredSupabaseAccessToken();
    if (!token) return;
    setBusyCaseId(deleteCandidate.id);
    try {
      await deleteAgronomicCase(deleteCandidate.id, token);
      setToast("Caso excluído permanentemente, incluindo registros relacionados e arquivos no storage.");
      setDeleteCandidate(null);
      setDeleteConfirmation("");
      setCases((current) => current.filter((caseItem) => caseItem.id !== deleteCandidate.id));
      setAiCases((current) => current.filter((caseItem) => caseItem.id !== deleteCandidate.id));
      await loadDashboard();
      router.push("/revisao-humana", { scroll: false });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir.");
    } finally {
      setBusyCaseId(null);
    }
  }

  const detailCase = detail?.case;
  const detailStage = detailCase ? getClientReviewStage(detailCase) : null;
  const detailReview = detail?.humanReview ?? null;
  const detailHasOpinion = detailStage === "completed" && Boolean(detailReview?.reviewText || detailReview?.technicalRecommendation);
  const canCancel = detailCase ? ["pending_payment", "pending"].includes(detailCase.human_review_status ?? "") : false;
  const canRequest = detailStage ? ["not_requested", "pending_payment", "cancelled", "rejected"].includes(detailStage) : false;

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-14">
      <div className="rounded-[2rem] bg-gradient-to-br from-leaf-900 via-leaf-800 to-emerald-700 p-5 text-white shadow-soft sm:p-8 md:p-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-leaf-100 sm:tracking-[0.3em]">Revisão Humana</p>
            <h1 className="mt-3 text-2xl font-black sm:text-3xl md:text-5xl">Pareceres do agrônomo</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-leaf-50 md:text-base">Acompanhe o status de cada caso enviado para revisão e leia o parecer profissional assim que ele for concluído. Para solicitar um novo parecer, use “Localizar caso” ou “Enviar caso”.</p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 md:flex md:flex-wrap">
            <button type="button" onClick={() => setShowLocator(true)} className="rounded-full bg-white px-5 py-3 text-sm font-black text-leaf-800 shadow-soft hover:bg-leaf-50">Localizar caso</button>
            <Link href="/enviar-caso" className="rounded-full border border-white/40 px-5 py-3 text-center text-sm font-black text-white hover:bg-white/10">Enviar caso</Link>
          </div>
        </div>
      </div>

      {(toast || error) && (
        <div role={error ? "alert" : "status"} className={`mt-6 flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm font-semibold ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          <p>{error || toast}</p>
          <button type="button" onClick={() => { setError(null); setToast(null); }} className="shrink-0 rounded-full px-2 text-base leading-none opacity-70 hover:opacity-100" aria-label="Fechar mensagem">✕</button>
        </div>
      )}

      {!loading && firstUnseen && (
        <div role="status" className="mt-6 flex flex-col gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-lg font-black text-white">✓</span>
            <div>
              <p className="font-black text-emerald-950">{counts.unseen === 1 ? "Você recebeu um novo parecer do agrônomo" : `Você recebeu ${counts.unseen} novos pareceres do agrônomo`}</p>
              <p className="text-sm text-emerald-900">{counts.unseen === 1 ? `${firstUnseen.caseItem.crop} · concluído em ${formatDateTime(firstUnseen.caseItem.latestHumanReview?.reviewed_at)}` : "Os casos com parecer novo aparecem primeiro na lista."}</p>
            </div>
          </div>
          <button type="button" onClick={() => openCase(firstUnseen.caseItem.id)} className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800">Ler parecer</button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <SummaryTile label="Aguardando revisão" value={loading ? "–" : counts.waiting_review} />
        <SummaryTile label="Em análise" value={loading ? "–" : counts.in_review} />
        <SummaryTile label="Pareceres concluídos" value={loading ? "–" : counts.completed} highlight={counts.unseen > 0} />
        <SummaryTile label="Relatórios disponíveis" value={loading ? "–" : counts.reports} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-soft md:p-6">
          <SectionTitle title="Seus casos em revisão" subtitle="Selecione um caso para ver o status e o parecer do agrônomo." />
          <label className="sr-only" htmlFor="busca-revisao">Buscar casos</label>
          <input id="busca-revisao" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cultura, propriedade, resumo ou ID" className="w-full rounded-full border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-300" />
          <div className="mt-5 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible sm:pb-0" role="group" aria-label="Filtrar por status">
            {visibleFilters.map((key) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${filter === key ? "bg-leaf-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {filterLabels[key]} <span className={filter === key ? "text-leaf-100" : "text-slate-500"}>({counts[key]})</span>
              </button>
            ))}
          </div>
          <div className="mt-6 space-y-4">
            {loading && <><LoadingCard title="Carregando casos" /><LoadingCard title="Carregando casos" /></>}
            {!loading && error && cases.length === 0 && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800">
                <p className="font-bold">Não foi possível carregar seus casos.</p>
                <button type="button" onClick={() => loadDashboard()} className="mt-3 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-black text-red-700">Tentar novamente</button>
              </div>
            )}
            {!loading && !error && cases.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center">
                <h3 className="text-lg font-black text-slate-950">Nenhum caso enviado para revisão</h3>
                <p className="mt-2 text-sm text-slate-600">Escolha uma análise feita pela IA e solicite o parecer agronômico humano incluído no seu plano.</p>
                <button type="button" onClick={() => setShowLocator(true)} className="mt-4 rounded-full bg-leaf-600 px-5 py-2.5 text-sm font-black text-white">Localizar caso</button>
              </div>
            )}
            {!loading && cases.length > 0 && filteredCases.length === 0 && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-600">Nenhum caso encontrado com esse filtro ou busca.</div>}
            {!loading && filteredCases.map(({ caseItem, stage, isNew }) => {
              const paymentStatus = getPaymentStatus(caseItem);
              const info = REVIEW_STAGE_INFO[stage];
              const selected = selectedCaseId === caseItem.id;
              const completed = stage === "completed";
              return (
                <article key={caseItem.id} onClick={() => openCase(caseItem.id)} className={`cursor-pointer rounded-3xl border p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-leaf-200 ${selected ? "border-leaf-400 bg-leaf-50 ring-2 ring-leaf-200" : completed ? "border-emerald-200 bg-white" : "border-slate-100 bg-white"} ${completed ? "border-l-8 border-l-emerald-500" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={info.tone} label={info.label} />
                    {isNew && <span className="inline-flex rounded-full bg-gold-300 px-3 py-1 text-xs font-black text-gold-900">Novo parecer</span>}
                    <RiskBadge riskLevel={caseItem.risk_level} />
                    {paymentStatus !== "included" && <StatusBadge status={paymentStatus} label={`Pagamento: ${paymentStatusLabels[paymentStatus] ?? paymentStatus}`} />}
                  </div>
                  <h3 className="mt-3 text-xl font-black text-slate-950">{caseItem.crop}</h3>
                  <p className="mt-1 break-words text-sm text-slate-600">{caseItem.farm?.name || "Propriedade não informada"} · {caseItem.images_count ?? caseItem.images?.length ?? 0} imagem(ns)</p>
                  {completed ? (
                    <p className="mt-3 text-sm font-semibold text-emerald-800">Parecer concluído em {formatDateTime(caseItem.latestHumanReview?.reviewed_at ?? caseItem.updated_at)}</p>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-600">{summarize(caseItem.ai_summary || caseItem.symptoms)}</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3" onClick={(event) => event.stopPropagation()}>
                    <p className="text-xs text-slate-500">Atualizado em {formatDateTime(caseItem.updated_at)}</p>
                    <div className="flex flex-wrap gap-2">
                      {caseItem.latestReport?.report_url && <a href={caseItem.latestReport.report_url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">Baixar relatório</a>}
                      <Link href={caseHref(caseItem.id)} scroll={false} aria-current={selected ? "true" : undefined} className={`rounded-full px-4 py-2 text-xs font-black ${completed ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                        {completed ? "Ver parecer" : "Acompanhar"}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside ref={detailRef} className="scroll-mt-24 space-y-5" aria-label="Detalhe do caso">
          {selectedCaseId && (
            <Link href="/revisao-humana" scroll={false} className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-soft xl:hidden">← Voltar para a lista</Link>
          )}
          {loadingDetail && <LoadingCard title="Carregando caso" description="Buscando status, parecer e histórico." rows={5} />}
          {!selectedCaseId && !loadingDetail && (
            <div className="hidden rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-soft xl:block">
              <h3 className="text-xl font-black text-slate-950">Selecione um caso</h3>
              <p className="mt-2 text-sm text-slate-600">O status da revisão e o parecer do agrônomo aparecem aqui.</p>
            </div>
          )}
          {selectedCaseId && detailError && !loadingDetail && (
            <div role="alert" className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 shadow-soft">
              <p className="font-black">Não foi possível abrir este caso.</p>
              <p className="mt-1">{detailError}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setDetailReload((value) => value + 1)} className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-black text-red-700">Tentar novamente</button>
                <Link href="/revisao-humana" scroll={false} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700">Voltar para a lista</Link>
              </div>
            </div>
          )}
          {detailCase && detailStage && !loadingDetail && !detailError && (
            <>
              <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={REVIEW_STAGE_INFO[detailStage].tone} label={REVIEW_STAGE_INFO[detailStage].label} />
                  <RiskBadge riskLevel={detailCase.risk_level} />
                </div>
                <h2 className="mt-3 text-2xl font-black text-slate-950 sm:text-3xl">{detailCase.crop}</h2>
                <p className="mt-1 text-sm text-slate-600">{detailCase.farm?.name || "Propriedade não informada"} · enviado em {formatDateTime(detailCase.created_at)}</p>
                <div className="mt-4">
                  <ReviewStatusPanel stage={detailStage}>
                    {canRequest && (
                      <button type="button" onClick={() => requestReview(detailCase.id)} disabled={busyCaseId === detailCase.id} className="mt-3 rounded-full bg-leaf-700 px-5 py-2.5 text-sm font-black text-white hover:bg-leaf-800 disabled:bg-slate-300">
                        {busyCaseId === detailCase.id ? "Enviando..." : "Solicitar parecer agronômico"}
                      </button>
                    )}
                  </ReviewStatusPanel>
                </div>
              </div>

              {detailHasOpinion && detailReview && <AgronomistOpinionCard review={detailReview} isNew={openedAsNew} report={detail?.latestReport} />}
              {detailStage === "completed" && !detailHasOpinion && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-soft">
                  A revisão consta como concluída, mas o texto do parecer não foi encontrado. Atualize a página ou fale com a equipe pela página de Contato.
                </div>
              )}
              {isReviewInProgress(detailStage) && <OpinionPendingCard stage={detailStage} requestedAt={detailReview?.requestedAt} />}

              <ReviewTimeline
                steps={buildReviewTimeline({ stage: detailStage, caseCreatedAt: detailCase.created_at, hasAiAnalysis: Boolean(detailCase.ai_summary), review: detailReview })}
                logs={detail?.activityLogs ?? []}
              />

              <InitialAnalysisSection caseData={detailCase} review={detailReview} hasOpinion={detailHasOpinion} />

              <CaseOriginalInfo
                caseData={detailCase}
                actions={
                  <div className="grid gap-2 border-t border-slate-100 pt-4 sm:flex sm:flex-wrap">
                    <Link href={`/consultoria-ia?caseId=${detailCase.id}`} className="rounded-full border border-slate-200 px-4 py-2 text-center text-xs font-black text-slate-700">Continuar conversa com IA</Link>
                    <Link href={`/enviar-caso?caseId=${detailCase.id}`} className="rounded-full border border-slate-200 px-4 py-2 text-center text-xs font-black text-slate-700">Enviar novas imagens</Link>
                    {canCancel && <button type="button" onClick={() => cancelReview(detailCase.id)} disabled={busyCaseId === detailCase.id} className="rounded-full border border-amber-200 px-4 py-2 text-xs font-black text-amber-700 disabled:opacity-50">Cancelar solicitação</button>}
                    <button type="button" onClick={() => setDeleteCandidate(detailCase)} disabled={busyCaseId === detailCase.id} className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700 disabled:opacity-50">Excluir caso</button>
                  </div>
                }
              />
            </>
          )}
        </aside>
      </div>

      <div className="mt-8"><SafetyDisclaimer /></div>

      {showLocator && (
        <div role="dialog" aria-modal="true" aria-label="Casos analisados pela IA" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-[2rem] bg-white p-4 shadow-soft sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <SectionTitle title="Casos analisados pela IA" subtitle="Escolha um caso já analisado para ver a análise, continuar a conversa ou solicitar o parecer agronômico." />
              <button type="button" onClick={() => setShowLocator(false)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black">Fechar</button>
            </div>
            {aiCases.length === 0 && <p className="mt-5 rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-600">Nenhum caso analisado pela IA ainda. <Link href="/enviar-caso" className="font-black text-leaf-700 underline">Enviar caso</Link></p>}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {aiCases.map((caseItem) => {
                const stage = getClientReviewStage(caseItem);
                const info = REVIEW_STAGE_INFO[stage];
                const alreadyRequested = !["not_requested", "pending_payment", "cancelled", "rejected"].includes(stage);
                return (
                  <article key={caseItem.id} className="rounded-3xl border border-slate-100 p-5 shadow-soft">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black text-slate-950">{caseItem.crop}</h3><RiskBadge riskLevel={caseItem.risk_level} /><StatusBadge status={info.tone} label={info.label} /></div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                      <p><strong>Propriedade:</strong> {caseItem.farm?.name || "Não informada"}</p>
                      <p><strong>Data da análise:</strong> {formatDateTime(caseItem.created_at)}</p>
                      <p><strong>Imagens:</strong> {caseItem.images_count ?? 0}</p>
                      <p><strong>Última atualização:</strong> {formatDateTime(caseItem.updated_at)}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600"><strong>Resumo da IA:</strong> {summarize(caseItem.ai_summary, 220)}</p>
                    <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                      <button type="button" onClick={() => { setShowLocator(false); openCase(caseItem.id); }} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700">{alreadyRequested ? "Ver revisão" : "Ver análise"}</button>
                      <Link href={`/consultoria-ia?caseId=${caseItem.id}`} className="rounded-full border border-slate-200 px-4 py-2 text-center text-xs font-black text-slate-700">Continuar conversa</Link>
                      <button type="button" onClick={() => requestReview(caseItem.id)} disabled={busyCaseId === caseItem.id || alreadyRequested} className="rounded-full bg-leaf-600 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300">{alreadyRequested ? "Já enviado para revisão" : busyCaseId === caseItem.id ? "Enviando..." : "Solicitar parecer agronômico"}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div role="dialog" aria-modal="true" aria-labelledby="excluir-caso-titulo" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-4 shadow-soft sm:p-6">
            <p className="text-sm font-bold uppercase tracking-wide text-red-600">Excluir caso</p>
            <h3 id="excluir-caso-titulo" className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">Esta ação não poderá ser desfeita.</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">O caso <strong>{deleteCandidate.crop}</strong>, imagens, conversas, perguntas pendentes, análises, revisões humanas, relatórios, pedidos relacionados permitidos e uploads no storage serão removidos.</p>
            <label htmlFor="confirmar-exclusao" className="mt-5 block text-sm font-semibold text-slate-700">Digite <span className="font-black text-red-700">EXCLUIR</span> para confirmar.</label>
            <input id="confirmar-exclusao" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-red-300" />
            <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
              <button type="button" onClick={() => { setDeleteCandidate(null); setDeleteConfirmation(""); }} className="rounded-full border border-slate-200 px-5 py-2 text-sm font-black text-slate-700">Cancelar</button>
              <button type="button" onClick={confirmDeleteCase} disabled={deleteConfirmation !== "EXCLUIR" || busyCaseId === deleteCandidate.id} className="rounded-full bg-red-600 px-5 py-2 text-sm font-black text-white disabled:bg-slate-300">Excluir definitivamente</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function RevisaoHumanaPage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-600 sm:px-6 md:py-14">Carregando revisão humana...</section>}>
      <RevisaoHumanaContent />
    </Suspense>
  );
}

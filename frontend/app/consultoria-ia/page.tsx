"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import CaseDetailPanel from "../../components/agronomic/case/CaseDetailPanel";
import { IconChevron, IconImage, IconRetry, IconUser } from "../../components/agronomic/case/icons";
import { getAgronomicCases } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase } from "../../lib/agronomic/case";

type PlanSlug = "gratuito" | "ia-basica" | "ia-profissional" | "premium";
type ListCase = AgronomicCase & {
  latestHumanReview?: { id: string; status: string | null; reviewed_at: string | null; created_at: string | null } | null;
  latestReport?: { id: string; report_url: string | null; report_type: string | null; created_at: string | null } | null;
  images_count?: number;
  updated_at?: string | null;
};
type Filters = { q: string; crop: string; status: string; risk: string; farm: string; period: string; humanOnly: boolean };
type ToastState = { type: "success" | "error"; message: string } | null;
type PlanState = { slug: PlanSlug; label: string; remaining: number | null; subscriptionStatus: string };

const PAGE_SIZE = 20;
const FETCH_LIMIT = 100;

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  ai_analyzed: "IA analisou",
  waiting_payment_human_review: "Aguardando pagamento",
  waiting_human_review: "Aguardando especialista",
  human_reviewed: "Revisado por especialista",
  completed: "Concluído",
};
const riskLabels: Record<string, string> = { low: "Baixo", medium: "Médio", high: "Alto" };
const EMPTY_FILTERS: Filters = { q: "", crop: "", status: "", risk: "", farm: "", period: "", humanOnly: false };

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function initials(value?: string | null) {
  return (value || "Caso").trim().slice(0, 2).toUpperCase();
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function CaseCardHeader({ item, expanded, onToggle, panelId }: { item: ListCase; expanded: boolean; onToggle: (element: HTMLElement) => void; panelId: string }) {
  const attachments = item.images_count ?? item.images?.length ?? 0;
  const location = [item.farm?.city, item.farm?.state].filter(Boolean).join("/");
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={(event) => onToggle(event.currentTarget)}
      className="flex w-full items-start gap-3 rounded-[1.4rem] p-4 text-left transition hover:bg-leaf-50/40 sm:p-5"
      data-testid="case-card-toggle"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-black ${expanded ? "bg-leaf-700 text-white" : "bg-leaf-100 text-leaf-800"}`}>{initials(item.crop)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-base font-black text-slate-950 sm:text-lg">{item.crop}</span>
            <span className="block truncate text-sm text-slate-500">{[item.farm?.name, location].filter(Boolean).join(" · ") || "Local não informado"}</span>
          </span>
          <RiskBadge riskLevel={item.risk_level} fallback="Risco pendente" />
        </span>
        <span className="mt-2.5 flex flex-wrap gap-1.5">
          <StatusBadge status={item.status} label={statusLabels[item.status || ""] ?? item.status ?? "Sem status"} />
          {item.human_review_requested ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-moss-200 bg-moss-50 px-2.5 py-0.5 text-xs font-bold text-moss-700"><IconUser className="h-3 w-3" /> Especialista</span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-bold text-slate-600"><IconImage className="h-3 w-3" /> {attachments}</span>
        </span>
        {!expanded ? <span className="mt-2 line-clamp-2 block text-sm leading-6 text-slate-600">{item.symptoms}</span> : null}
        <span className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-400">
          <span className="min-w-0 truncate">Atualizado em {formatDate(item.updated_at ?? item.created_at)}</span>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-leaf-700">
            {expanded ? "Recolher" : "Abrir caso"}
            <IconChevron className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </span>
        </span>
      </span>
    </button>
  );
}

function ConsultoriaIAContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCaseId = searchParams.get("caseId") ?? "";
  const [cases, setCases] = useState<ListCase[]>([]);
  const [expandedId, setExpandedId] = useState(initialCaseId);
  const [editRequestId, setEditRequestId] = useState<string | null>(searchParams.get("editar") ? initialCaseId || null : null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [plan, setPlan] = useState<PlanState>({ slug: "gratuito", label: "Gratuito", remaining: null, subscriptionStatus: "Sem assinatura ativa" });
  const [toast, setToast] = useState<ToastState>(null);
  const [humanReviewingId, setHumanReviewingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [upsellMessage, setUpsellMessage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const anchorRef = useRef<{ element: HTMLElement; top: number } | null>(null);

  const getAccessToken = useCallback(() => (typeof window === "undefined" ? null : getStoredSupabaseAccessToken()), []);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast((current) => (current?.message === message ? null : current)), 5000);
  }, []);

  const loadCases = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setListError("Faça login para acessar sua central de consultoria agronômica.");
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    setListError(null);
    try {
      const response = (await getAgronomicCases(token, { limit: FETCH_LIMIT })) as { cases: ListCase[]; plan?: PlanState; pagination?: { hasMore?: boolean } };
      setCases(response.cases ?? []);
      setHasMore(Boolean(response.pagination?.hasMore));
      if (response.plan) setPlan(response.plan);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Não foi possível carregar os casos.");
    } finally {
      setLoadingList(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(normalize(filters.q.trim())), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  const crops = useMemo(() => Array.from(new Set(cases.map((item) => item.crop).filter(Boolean))).sort(), [cases]);
  const farms = useMemo(() => Array.from(new Set(cases.map((item) => item.farm?.name).filter(Boolean) as string[])).sort(), [cases]);
  const filteredCases = useMemo(
    () =>
      cases.filter((item) => {
        const haystack = normalize(`${item.crop} ${item.farm?.name ?? ""} ${item.farm?.city ?? ""} ${item.farm?.state ?? ""} ${item.symptoms} ${item.history ?? ""}`);
        if (debouncedQuery && !haystack.includes(debouncedQuery)) return false;
        if (filters.crop && item.crop !== filters.crop) return false;
        if (filters.status && item.status !== filters.status) return false;
        if (filters.risk && item.risk_level !== filters.risk) return false;
        if (filters.farm && item.farm?.name !== filters.farm) return false;
        if (filters.humanOnly && !item.human_review_requested) return false;
        if (filters.period) {
          const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;
          if (createdAt < Date.now() - Number(filters.period) * 86400000) return false;
        }
        return true;
      }),
    [cases, debouncedQuery, filters],
  );
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageCases = filteredCases.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeFilterCount = [filters.crop, filters.status, filters.risk, filters.farm, filters.period].filter(Boolean).length + (filters.humanOnly ? 1 : 0);

  useEffect(() => setPage(1), [debouncedQuery, filters.crop, filters.status, filters.risk, filters.farm, filters.period, filters.humanOnly]);

  // Caso vindo pela URL: vai para a página dele (sem rolar a tela).
  const initialPageResolved = useRef(false);
  useEffect(() => {
    if (initialPageResolved.current || !initialCaseId || !filteredCases.length) return;
    const index = filteredCases.findIndex((item) => item.id === initialCaseId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
    initialPageResolved.current = true;
  }, [filteredCases, initialCaseId]);

  const stats = useMemo(
    () => ({
      active: cases.filter((item) => !["completed", "human_reviewed"].includes(item.status ?? "")).length,
      high: cases.filter((item) => item.risk_level === "high").length,
      review: cases.filter((item) => item.human_review_requested).length,
    }),
    [cases],
  );

  // Mantém o cartão clicado na mesma posição da tela depois de abrir/recolher
  // (compensa o conteúdo que muda acima dele). Não há rolagem automática.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    if (!anchor.element.isConnected) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: "instant" as ScrollBehavior });
  }, [expandedId]);

  function toggleCase(id: string, element?: HTMLElement) {
    if (element) anchorRef.current = { element, top: element.getBoundingClientRect().top };
    const next = expandedId === id ? "" : id;
    setExpandedId(next);
    setEditRequestId(null);
    router.replace(next ? `/consultoria-ia?caseId=${encodeURIComponent(next)}` : "/consultoria-ia", { scroll: false });
  }

  const handleCaseUpdated = useCallback((caseData: AgronomicCase) => {
    setCases((current) =>
      current.map((item) =>
        item.id === caseData.id
          ? { ...item, ...caseData, images_count: caseData.images?.length ?? item.images_count, chat_messages: undefined, pending_questions: undefined }
          : item,
      ),
    );
  }, []);

  async function requestHumanReview(caseId: string) {
    const token = getAccessToken();
    if (!token || humanReviewingId) return;
    setHumanReviewingId(caseId);
    try {
      const response = await fetch("/api/agronomic-cases/request-human-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ caseId }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 402) {
        setUpsellMessage(payload?.error || "O parecer agronômico humano está disponível nos planos PlantaSa IA Profissional e PlantaSa Consultoria Agronômica.");
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Não foi possível solicitar o parecer.");
      showToast("success", payload?.humanOpinion?.balanceLabel ? `Seu caso foi encaminhado para avaliação especializada. ${payload.humanOpinion.balanceLabel}.` : "Seu caso foi encaminhado para avaliação especializada");
      router.push(payload?.redirectTo || `/revisao-humana?caseId=${encodeURIComponent(caseId)}`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Não foi possível solicitar o parecer.");
    } finally {
      setHumanReviewingId(null);
    }
  }

  async function confirmDelete() {
    const token = getAccessToken();
    if (!token || !deleteTarget || deleting) return;
    if (deleteConfirmation.trim().toUpperCase() !== "EXCLUIR") {
      setDeleteError("Digite EXCLUIR para confirmar.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(deleteTarget)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível excluir o caso.");
      setCases((current) => current.filter((item) => item.id !== deleteTarget));
      if (expandedId === deleteTarget) {
        setExpandedId("");
        router.replace("/consultoria-ia", { scroll: false });
      }
      setDeleteTarget(null);
      setDeleteConfirmation("");
      showToast("success", "Caso excluído com sucesso.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Não foi possível excluir o caso.");
    } finally {
      setDeleting(false);
    }
  }

  const selectClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dcfce7_0,transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef7ef_100%)] px-3 py-5 text-slate-900 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-[1100px] space-y-5">
        <header className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-leaf-900 via-leaf-800 to-emerald-700 p-5 text-white shadow-soft sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-leaf-100 ring-1 ring-white/10">Meus casos</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-leaf-800">{plan.label}</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-4xl">Consultoria Agronômica Inteligente</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-leaf-50 sm:text-base">Acompanhe cada caso, converse com a IA e envie novas fotos e áudios.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <Link href="/enviar-caso?destino=consultoria-ia" className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-black text-leaf-800 shadow-soft hover:bg-leaf-50">Novo caso</Link>
              <button type="button" onClick={() => void loadCases()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/40 px-5 text-sm font-black text-white hover:bg-white/10">
                <IconRetry className="h-4 w-4" /> Atualizar
              </button>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Análises restantes", plan.remaining === null ? "Ilimitado" : String(plan.remaining)],
              ["Casos em andamento", String(stats.active)],
              ["Com especialista", String(stats.review)],
              ["Risco alto", String(stats.high)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10">
                <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-leaf-100">{label}</dt>
                <dd className="mt-0.5 text-xl font-black">{value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {toast ? (
          <div role="status" className={`sticky top-2 z-30 rounded-2xl border p-3.5 text-sm font-semibold shadow-sm ${toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {toast.message}
          </div>
        ) : null}

        <section className="rounded-[1.5rem] border border-white/80 bg-white/90 p-3 shadow-soft sm:p-4" aria-label="Busca e filtros">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="case-search">Buscar casos</label>
            <input id="case-search" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Buscar por cultura, propriedade, cidade ou sintoma" className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 text-base outline-none focus:border-leaf-400 sm:text-sm" />
            <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700">
              Filtros{activeFilterCount ? ` (${activeFilterCount})` : ""}
              <IconChevron className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </div>
          {showFilters ? (
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
              <select aria-label="Cultura" value={filters.crop} onChange={(e) => setFilters((c) => ({ ...c, crop: e.target.value }))} className={selectClass}><option value="">Cultura</option>{crops.map((crop) => <option key={crop}>{crop}</option>)}</select>
              <select aria-label="Status" value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))} className={selectClass}><option value="">Status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
              <select aria-label="Risco" value={filters.risk} onChange={(e) => setFilters((c) => ({ ...c, risk: e.target.value }))} className={selectClass}><option value="">Risco</option>{Object.entries(riskLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
              <select aria-label="Propriedade" value={filters.farm} onChange={(e) => setFilters((c) => ({ ...c, farm: e.target.value }))} className={selectClass}><option value="">Propriedade</option>{farms.map((farm) => <option key={farm}>{farm}</option>)}</select>
              <select aria-label="Período" value={filters.period} onChange={(e) => setFilters((c) => ({ ...c, period: e.target.value }))} className={selectClass}><option value="">Período</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"><input type="checkbox" className="h-4 w-4" checked={filters.humanOnly} onChange={(e) => setFilters((c) => ({ ...c, humanOnly: e.target.checked }))} /> Com especialista</label>
              {activeFilterCount ? <button type="button" onClick={() => setFilters((current) => ({ ...EMPTY_FILTERS, q: current.q }))} className="col-span-2 min-h-11 rounded-xl text-sm font-bold text-leaf-700 lg:col-span-6">Limpar filtros</button> : null}
            </div>
          ) : null}
        </section>

        <div className="flex items-center justify-between px-1 text-sm text-slate-500">
          <span>{loadingList ? "Carregando casos..." : `${filteredCases.length} ${filteredCases.length === 1 ? "caso" : "casos"}`}</span>
          {totalPages > 1 ? <span>Página {currentPage} de {totalPages}</span> : null}
        </div>

        {listError ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{listError}</span>
            <button type="button" onClick={() => void loadCases()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-4 font-bold text-white"><IconRetry className="h-4 w-4" /> Tentar novamente</button>
          </div>
        ) : null}

        <ul className="space-y-3 [overflow-anchor:none]" aria-label="Casos agronômicos">
          {loadingList && !cases.length
            ? [0, 1, 2].map((key) => <li key={key} className="h-32 animate-pulse rounded-[1.5rem] bg-white shadow-soft" />)
            : null}
          {!loadingList && !listError && !filteredCases.length ? (
            <li className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white/80 p-8 text-center">
              <p className="text-lg font-bold text-slate-900">{cases.length ? "Nenhum caso encontrado" : "Você ainda não tem casos"}</p>
              <p className="mt-1 text-sm text-slate-500">{cases.length ? "Ajuste a busca ou os filtros." : "Crie um caso para receber a análise da IA."}</p>
            </li>
          ) : null}
          {pageCases.map((item) => {
            const expanded = expandedId === item.id;
            const panelId = `case-panel-${item.id}`;
            return (
              <li key={item.id} className={`rounded-[1.5rem] border bg-white shadow-soft transition-colors ${expanded ? "border-leaf-400 ring-4 ring-leaf-100" : "border-slate-100"}`} data-testid="case-card" data-case-id={item.id} data-expanded={expanded}>
                <CaseCardHeader item={item} expanded={expanded} onToggle={(element) => toggleCase(item.id, element)} panelId={panelId} />
                {expanded ? (
                  <div id={panelId} className="border-t border-leaf-100 px-3 pb-4 pt-4 sm:px-5 sm:pb-5">
                    <CaseDetailPanel
                      caseId={item.id}
                      getAccessToken={getAccessToken}
                      analysesRemaining={plan.remaining}
                      openEditorOnLoad={editRequestId === item.id}
                      onEditorOpened={() => setEditRequestId(null)}
                      onCaseUpdated={handleCaseUpdated}
                      onRequestHumanReview={requestHumanReview}
                      requestingHumanReview={humanReviewingId === item.id}
                      onDelete={(id) => { setDeleteTarget(id); setDeleteConfirmation(""); setDeleteError(null); }}
                      onToast={showToast}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2" aria-label="Paginação">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="min-h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold disabled:opacity-40">Anterior</button>
            <span className="px-2 text-sm font-semibold text-slate-600">{currentPage} / {totalPages}</span>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="min-h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold disabled:opacity-40">Próxima</button>
          </nav>
        ) : null}
        {hasMore ? <p className="text-center text-xs text-slate-500">Exibindo os {FETCH_LIMIT} casos mais recentes. Use a busca para encontrar casos antigos.</p> : null}

        <SafetyDisclaimer />
      </div>

      {deleteTarget ? (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[1.75rem] bg-white p-5 shadow-soft">
            <h2 id="delete-title" className="text-xl font-black">Excluir caso</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Esta ação não pode ser desfeita. O caso, as conversas, os anexos e os registros de revisão serão excluídos. Digite <strong>EXCLUIR</strong> para confirmar.</p>
            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} disabled={deleting} aria-label="Palavra de confirmação" placeholder="EXCLUIR" className="mt-4 min-h-11 w-full rounded-xl border border-slate-200 px-3.5 text-base outline-none focus:border-red-300" />
            {deleteError ? <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{deleteError}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting} className="min-h-11 rounded-full border border-slate-200 px-5 text-sm font-bold">Cancelar</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting || deleteConfirmation.trim().toUpperCase() !== "EXCLUIR"} className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-bold text-white disabled:bg-slate-300">{deleting ? "Excluindo..." : "Excluir caso"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {upsellMessage ? (
        <div role="dialog" aria-modal="true" aria-labelledby="upsell-title" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[1.75rem] bg-white p-5 shadow-soft">
            <h2 id="upsell-title" className="text-xl font-black">Parecer agronômico humano</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{upsellMessage}</p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:flex">
              <Link href="/planos" className="inline-flex min-h-11 items-center justify-center rounded-full bg-leaf-600 px-5 text-sm font-bold text-white">Ver planos</Link>
              <button type="button" onClick={() => setUpsellMessage(null)} className="min-h-11 rounded-full border border-slate-200 px-5 text-sm font-bold">Fechar</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function ConsultoriaIAPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-600">Carregando casos...</div>}>
      <ConsultoriaIAContent />
    </Suspense>
  );
}

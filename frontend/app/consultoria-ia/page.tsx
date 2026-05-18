"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import { analyzeAgronomicCase, getAgronomicCase, getAgronomicCases } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase, AgronomicPreAnalysis, AgronomicRiskLevel } from "../../lib/agronomic/case";

type CaseStatus = "draft" | "submitted" | "ai_analyzed" | "waiting_human_review" | "human_reviewed" | "completed" | "deleted";
type PlanSlug = "gratuito" | "ia-basica" | "ia-profissional" | "premium";
type ActivityLog = { id: string; action: string; metadata?: Record<string, unknown> | null; created_at: string | null };
type ListCase = AgronomicCase & {
  latestHumanReview?: { id: string; status: string | null; reviewed_at: string | null; created_at: string | null } | null;
  latestReport?: { id: string; report_url: string | null; report_type: string | null; created_at: string | null } | null;
  images_count?: number;
  updated_at?: string | null;
};
type ChatMessage = { id?: string; role: "user" | "assistant"; content: string; created_at?: string | null };
type Filters = { q: string; crop: string; status: string; risk: string; farm: string; period: string; humanOnly: boolean };
type ToastState = { type: "success" | "error"; message: string } | null;

type EditForm = {
  crop: string;
  farmName: string;
  city: string;
  state: string;
  areaHectares: string;
  soilType: string;
  growthStage: string;
  symptoms: string;
  managementHistory: string;
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  ai_analyzed: "IA analisou",
  waiting_human_review: "Aguardando revisão humana",
  human_reviewed: "Revisado por especialista",
  completed: "Concluído",
  deleted: "Excluído",
};

const riskLabels: Record<string, string> = { low: "Baixo", medium: "Médio", high: "Alto" };
const planLabels: Record<PlanSlug, string> = { gratuito: "Gratuito", "ia-basica": "IA Básica", "ia-profissional": "IA Profissional", premium: "Premium" };

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function text(value?: string | number | null) {
  return value === null || value === undefined || value === "" ? "Não informado" : String(value);
}

function initials(value?: string | null) {
  return (value || "Caso").slice(0, 2).toUpperCase();
}

function Skeleton() {
  return <div className="animate-pulse rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-soft"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="mt-4 h-20 rounded bg-slate-100" /></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white/80 p-8 text-center"><p className="text-lg font-bold text-slate-900">{title}</p><p className="mt-2 text-sm text-slate-500">{description}</p></div>;
}

function MetricCard({ label, value, tone = "leaf" }: { label: string; value: string | number; tone?: "leaf" | "amber" | "red" | "slate" }) {
  const tones = { leaf: "from-leaf-600 to-emerald-500", amber: "from-amber-500 to-orange-500", red: "from-red-500 to-rose-500", slate: "from-slate-800 to-slate-600" };
  return <div className="rounded-[1.5rem] border border-white/70 bg-white p-4 shadow-soft"><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p><p className={`mt-3 bg-gradient-to-r ${tones[tone]} bg-clip-text text-3xl font-black text-transparent`}>{value}</p></div>;
}

function CaseCard({ item, active, onSelect, onAction }: { item: ListCase; active: boolean; onSelect: () => void; onAction: (action: string, item: ListCase) => void }) {
  const attachmentCount = item.images_count ?? item.images?.length ?? 0;
  return (
    <article className={`rounded-[1.5rem] border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 ${active ? "border-leaf-400 ring-4 ring-leaf-100" : "border-slate-100"}`}>
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-leaf-100 font-black text-leaf-800">{initials(item.crop)}</div>
            <div>
              <h3 className="font-bold text-slate-950">{item.crop}</h3>
              <p className="text-sm text-slate-500">{text(item.farm?.name)} · {[item.farm?.city, item.farm?.state].filter(Boolean).join("/") || "Localização não informada"}</p>
            </div>
          </div>
          <RiskBadge riskLevel={item.risk_level} fallback="Risco pendente" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge status={item.status} label={statusLabels[item.status || ""] ?? item.status ?? "Sem status"} />
          {item.human_review_requested && <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-800">Revisão humana</span>}
          {item.latestReport?.report_url && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Relatório PDF</span>}
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">{attachmentCount} anexos</span>
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{item.symptoms}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{formatDate(item.updated_at ?? item.created_at)}</p>
      </button>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-700 md:grid-cols-4">
        <button onClick={() => onAction("open", item)} className="rounded-xl border border-slate-200 px-3 py-2 hover:border-leaf-300">Abrir</button>
        <button onClick={() => onAction("edit", item)} className="rounded-xl border border-slate-200 px-3 py-2 hover:border-leaf-300">Editar</button>
        <button onClick={() => onAction("ai", item)} className="rounded-xl border border-slate-200 px-3 py-2 hover:border-leaf-300">Nova IA</button>
        <button onClick={() => onAction("more", item)} className="rounded-xl border border-slate-200 px-3 py-2 hover:border-leaf-300">Ações</button>
      </div>
    </article>
  );
}

function DetailBlock({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p><p className="mt-2 text-sm font-semibold leading-6 text-slate-900">{text(value)}</p></div>;
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-[1.25rem] bg-leaf-50 p-5"><h4 className="font-bold text-slate-950">{title}</h4><ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">{items.length ? items.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600" />{item}</li>) : <li className="text-slate-500">Aguardando geração de análise.</li>}</ul></div>;
}

function ConsultoriaIAContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCaseId = searchParams.get("caseId") ?? "";
  const [cases, setCases] = useState<ListCase[]>([]);
  const [selectedId, setSelectedId] = useState(initialCaseId);
  const [selectedCase, setSelectedCase] = useState<AgronomicCase | null>(null);
  const [analysis, setAnalysis] = useState<AgronomicPreAnalysis | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [filters, setFilters] = useState<Filters>({ q: "", crop: "", status: "", risk: "", farm: "", period: "", humanOnly: false });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingCase, setLoadingCase] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ slug: PlanSlug; label: string; remaining: number | null; subscriptionStatus: string }>({ slug: "gratuito", label: "Gratuito", remaining: 1, subscriptionStatus: "Sem assinatura ativa" });
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const [showActions, setShowActions] = useState<ListCase | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [humanReviewingId, setHumanReviewingId] = useState<string | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({ crop: "", farmName: "", city: "", state: "", areaHectares: "", soilType: "", growthStage: "", symptoms: "", managementHistory: "" });
  const [newImages, setNewImages] = useState<File[]>([]);
  const [soilFile, setSoilFile] = useState<File | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const token = typeof window === "undefined" ? null : getStoredSupabaseAccessToken();
  const selectedListItem = useMemo(() => cases.find((item) => item.id === selectedId) ?? null, [cases, selectedId]);
  const isDeletingEnabled = deleteConfirmation.trim().toUpperCase() === "EXCLUIR";

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast((current) => (current?.message === message ? null : current)), 5000);
  }, []);

  const logDevError = useCallback((context: string, err: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      console.error(context, err);
    }
  }, []);

  const loadCases = useCallback(async (preferredId?: string | null) => {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) { const message = "Faça login para acessar sua central de consultoria agronômica."; setError(message); showToast("error", message); setLoadingList(false); return; }
    setLoadingList(true);
    try {
      const response = await getAgronomicCases(accessToken) as { cases: ListCase[]; plan?: typeof plan };
      setCases(response.cases ?? []);
      if (response.plan) setPlan(response.plan);
      const candidateId = preferredId === null ? "" : preferredId || selectedId;
      const nextId = candidateId && response.cases?.some((caseItem) => caseItem.id === candidateId) ? candidateId : (preferredId === null ? "" : response.cases?.[0]?.id || "");
      setSelectedId(nextId);
    } catch (err) { const message = err instanceof Error ? err.message : "Não foi possível carregar os casos."; setError(message); showToast("error", message); logDevError("Erro ao carregar casos", err); }
    finally { setLoadingList(false); }
  }, [selectedId, showToast, logDevError]);

  const loadSelectedCase = useCallback(async (caseId: string) => {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !caseId) return;
    setLoadingCase(true);
    setError(null);
    try {
      const response = await getAgronomicCase(caseId, accessToken) as { case: AgronomicCase; activityLogs?: ActivityLog[] };
      setSelectedCase(response.case);
      setAnalysis(response.case.ai_summary ? {
        initialDiagnosis: response.case.ai_summary,
        probableHypotheses: [],
        missingQuestions: (response.case.pending_questions ?? []).filter((item) => item.status === "pending").map((item) => item.question),
        riskLevel: response.case.risk_level ?? "medium",
        initialRecommendation: response.case.ai_recommendation ?? "Aguardando recomendações da IA.",
        whenToCallHumanSpecialist: "Solicite revisão humana para decisões de alto impacto agronômico.",
        disclaimer: "As orientações geradas por IA são informativas e não substituem avaliação profissional.",
        knowledgeUsed: [],
      } : null);
      setChatMessages((response.case.chat_messages ?? []).map((message) => ({ id: message.id, role: message.role, content: message.message, created_at: message.created_at })));
      setActivityLogs(response.activityLogs ?? []);
      setEditForm({ crop: response.case.crop ?? "", farmName: response.case.farm?.name ?? "", city: response.case.farm?.city ?? "", state: response.case.farm?.state ?? "", areaHectares: response.case.farm?.area_hectares ? String(response.case.farm.area_hectares) : "", soilType: response.case.farm?.soil_type ?? "", growthStage: response.case.growth_stage ?? "", symptoms: response.case.symptoms ?? "", managementHistory: response.case.history ?? "" });
      router.replace(`/consultoria-ia?caseId=${encodeURIComponent(caseId)}`, { scroll: false });
    } catch (err) { const message = err instanceof Error ? err.message : "Não foi possível abrir o caso."; setError(message); showToast("error", message); logDevError("Erro ao abrir caso", err); }
    finally { setLoadingCase(false); }
  }, [router, showToast, logDevError]);

  useEffect(() => { loadCases(initialCaseId); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedId) loadSelectedCase(selectedId); }, [selectedId, loadSelectedCase]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(filters.q.trim().toLowerCase()), 350); return () => window.clearTimeout(timer); }, [filters.q]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, chatLoading]);

  const crops = useMemo(() => Array.from(new Set(cases.map((item) => item.crop).filter(Boolean))).sort(), [cases]);
  const farms = useMemo(() => Array.from(new Set(cases.map((item) => item.farm?.name).filter(Boolean) as string[])).sort(), [cases]);
  const filteredCases = useMemo(() => cases.filter((item) => {
    const haystack = `${item.crop} ${item.farm?.name ?? ""} ${item.farm?.city ?? ""} ${item.farm?.state ?? ""} ${item.symptoms} ${item.history ?? ""}`.toLowerCase();
    if (debouncedQuery && !haystack.includes(debouncedQuery)) return false;
    if (filters.crop && item.crop !== filters.crop) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.risk && item.risk_level !== filters.risk) return false;
    if (filters.farm && item.farm?.name !== filters.farm) return false;
    if (filters.humanOnly && !item.human_review_requested) return false;
    if (filters.period) {
      const days = Number(filters.period);
      const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;
      if (createdAt < Date.now() - days * 86400000) return false;
    }
    return true;
  }), [cases, debouncedQuery, filters]);

  const stats = useMemo(() => ({ total: cases.length, high: cases.filter((item) => item.risk_level === "high").length, review: cases.filter((item) => item.human_review_requested).length, pending: cases.filter((item) => item.status !== "completed").length }), [cases]);

  async function handleGenerateAnalysis(caseId = selectedId) {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !caseId) return;
    setGenerating(true);
    setError(null);
    try {
      const response = await analyzeAgronomicCase(caseId, accessToken);
      setAnalysis(response.analysis);
      await loadCases(caseId);
      await loadSelectedCase(caseId);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível gerar a análise."); }
    finally { setGenerating(false); }
  }

  async function handleAskQuestion(event: FormEvent) {
    event.preventDefault();
    const accessToken = getStoredSupabaseAccessToken();
    const value = question.trim();
    if (!accessToken || !selectedId || !value) return;
    setQuestion("");
    setChatMessages((current) => [...current, { role: "user", content: value }]);
    setChatLoading(true);
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(selectedId)}/chat`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: (() => { const data = new FormData(); data.append("message", value); data.append("messageType", "text"); return data; })() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível continuar a conversa.");
      setChatMessages((payload.messages ?? []).map((message: { id: string; role: "user" | "assistant"; message: string; created_at: string | null }) => ({ id: message.id, role: message.role, content: message.message, created_at: message.created_at })));
      if (payload.analysis) setAnalysis(payload.analysis);
      await loadSelectedCase(selectedId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao conversar com a IA."); }
    finally { setChatLoading(false); }
  }

  async function handleSaveCase(reanalyze: boolean) {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !selectedId) return;
    setSavingEdit(true);
    try {
      const data = new FormData();
      Object.entries(editForm).forEach(([key, value]) => data.append(key, value));
      newImages.forEach((file) => data.append("photos", file));
      if (soilFile) data.append("soilAnalysis", soilFile);
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(selectedId)}`, { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` }, body: data });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o caso.");
      setShowEdit(false); setNewImages([]); setSoilFile(null);
      await loadCases(selectedId); await loadSelectedCase(selectedId);
      if (reanalyze) await handleGenerateAnalysis(selectedId);
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao salvar edição."); }
    finally { setSavingEdit(false); }
  }

  async function handleDelete() {
    const accessToken = getStoredSupabaseAccessToken();
    const caseIdToDelete = selectedId;
    setDeleteFeedback(null);
    setError(null);

    if (!accessToken) {
      const message = "Faça login para excluir o caso.";
      setDeleteFeedback(message);
      showToast("error", message);
      return;
    }

    if (!caseIdToDelete) {
      const message = "Selecione um caso para excluir.";
      setDeleteFeedback(message);
      showToast("error", message);
      return;
    }

    if (!isDeletingEnabled) {
      setDeleteFeedback("Digite EXCLUIR exatamente para habilitar a exclusão.");
      return;
    }

    setDeletingCase(true);
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseIdToDelete)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível excluir o caso. Tente novamente.");

      setCases((current) => current.filter((item) => item.id !== caseIdToDelete));
      setShowDelete(false);
      setDeleteConfirmation("");
      setDeleteFeedback(null);
      if (selectedId === caseIdToDelete) {
        setSelectedCase(null);
        setSelectedId("");
        router.replace("/consultoria-ia", { scroll: false });
      }
      showToast("success", "Caso excluído com sucesso.");
      await loadCases(null);
    } catch (err) {
      const message = "Não foi possível excluir o caso. Tente novamente.";
      setDeleteFeedback(message);
      setError(err instanceof Error ? err.message : message);
      showToast("error", message);
      logDevError("Erro ao excluir caso", err);
    } finally {
      setDeletingCase(false);
    }
  }

  async function requestHumanReview(caseId = selectedId) {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) {
      const message = "Faça login para solicitar revisão humana.";
      setError(message);
      showToast("error", message);
      return;
    }
    if (!caseId) {
      const message = "Selecione um caso para solicitar revisão humana.";
      setError(message);
      showToast("error", message);
      return;
    }
    if (humanReviewingId) return;

    setHumanReviewingId(caseId);
    setError(null);
    try {
      const response = await fetch("/api/agronomic-cases/request-human-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ caseId }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 402) {
        setSelectedId(caseId);
        setShowUpsell(true);
        showToast("error", payload?.error || "Contrate uma revisão avulsa ou o plano Premium para enviar este caso.");
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Não foi possível solicitar revisão humana.");

      if (payload?.case) {
        setCases((current) => current.map((item) => (item.id === caseId ? { ...item, ...payload.case } : item)));
        setSelectedCase((current) => (current?.id === caseId ? { ...current, ...payload.case } : current));
      }
      showToast("success", "Caso enviado para revisão humana.");
      await loadCases(caseId);
      await loadSelectedCase(caseId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível solicitar revisão humana.";
      setError(message);
      showToast("error", message);
      logDevError("Erro ao solicitar revisão humana", err);
    } finally {
      setHumanReviewingId(null);
    }
  }

  async function duplicateCase(item: ListCase) {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) return;
    const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(item.id)}/duplicate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) { setError(payload?.error || "Não foi possível duplicar."); return; }
    await loadCases(payload.caseId);
  }

  function handleAction(action: string, item: ListCase) {
    setShowActions(null);
    if (action === "open") setSelectedId(item.id);
    if (action === "edit") { setSelectedId(item.id); setShowEdit(true); }
    if (action === "delete") { setSelectedId(item.id); setDeleteConfirmation(""); setDeleteFeedback(null); setShowDelete(true); }
    if (action === "ai") handleGenerateAnalysis(item.id);
    if (action === "human") { setSelectedId(item.id); requestHumanReview(item.id); }
    if (action === "report") item.latestReport?.report_url ? window.open(item.latestReport.report_url, "_blank", "noopener") : setError("Este caso ainda não possui relatório PDF.");
    if (action === "duplicate") duplicateCase(item);
    if (action === "history") { setSelectedId(item.id); document.getElementById("case-timeline")?.scrollIntoView({ behavior: "smooth" }); }
    if (action === "more") setShowActions(item);
  }

  const hasAnalysis = Boolean(selectedCase?.ai_summary || analysis);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dcfce7_0,transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef7ef_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 p-6 text-white shadow-soft md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Centro operacional</span><span className="rounded-full bg-leaf-500 px-3 py-1 text-xs font-bold text-white">{plan.label || planLabels[plan.slug]}</span></div>
              <h1 className="text-3xl font-black tracking-tight md:text-5xl">Consultoria Agronômica Inteligente</h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">Análises organizadas com IA e suporte especializado.</p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link href="/enviar-caso" className="rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-soft transition hover:-translate-y-0.5">Novo Caso</Link>
              <button onClick={() => loadCases(selectedId)} className="rounded-full border border-white/20 px-5 py-3 text-sm font-black text-white hover:bg-white/10">Atualizar</button>
            </div>
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-300">Análises restantes no mês</p><p className="mt-2 text-2xl font-black">{plan.remaining === null ? "Ilimitado" : plan.remaining}</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-300">Status da assinatura</p><p className="mt-2 text-lg font-black">{plan.subscriptionStatus}</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-300">Casos em operação</p><p className="mt-2 text-2xl font-black">{stats.pending}</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-300">Risco alto</p><p className="mt-2 text-2xl font-black">{stats.high}</p></div>
          </div>
        </header>

        {toast && <div role="status" className={`rounded-2xl border p-4 text-sm font-semibold ${toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{toast.message}</div>}

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}

        <section className="grid gap-4 md:grid-cols-4"><MetricCard label="Total de casos" value={stats.total} /><MetricCard label="Revisão humana" value={stats.review} tone="slate" /><MetricCard label="Risco alto" value={stats.high} tone="red" /><MetricCard label="Análises IA" value={cases.filter((item) => item.ai_summary).length} tone="amber" /></section>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-soft backdrop-blur">
              <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">Casos enviados</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Paginação · 25 por página</span></div>
              <div className="mt-4 grid gap-3">
                <input value={filters.q} onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))} placeholder="Buscar por cultura, propriedade, cidade, sintomas..." className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-400" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={filters.crop} onChange={(e) => setFilters((c) => ({ ...c, crop: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Cultura</option>{crops.map((crop) => <option key={crop}>{crop}</option>)}</select>
                  <select value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                  <select value={filters.risk} onChange={(e) => setFilters((c) => ({ ...c, risk: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Risco</option>{Object.entries(riskLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                  <select value={filters.farm} onChange={(e) => setFilters((c) => ({ ...c, farm: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Propriedade</option>{farms.map((farm) => <option key={farm}>{farm}</option>)}</select>
                  <select value={filters.period} onChange={(e) => setFilters((c) => ({ ...c, period: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Período</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={filters.humanOnly} onChange={(e) => setFilters((c) => ({ ...c, humanOnly: e.target.checked }))} /> Só revisão humana</label>
                </div>
              </div>
            </div>
            <div className="space-y-3">{loadingList ? <><Skeleton /><Skeleton /><Skeleton /></> : filteredCases.length ? filteredCases.slice(0, 25).map((item) => <CaseCard key={item.id} item={item} active={item.id === selectedId} onSelect={() => setSelectedId(item.id)} onAction={handleAction} />) : <EmptyState title="Nenhum caso encontrado" description="Ajuste filtros ou crie um novo caso agronômico." />}</div>
          </aside>

          <section className="space-y-6">
            {!selectedCase && !loadingCase ? <EmptyState title="Selecione um caso" description="Abra um caso para visualizar análise IA, histórico operacional, anexos e ações de revisão humana." /> : null}
            {loadingCase ? <Skeleton /> : selectedCase ? (
              <>
                <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div><p className="text-xs font-black uppercase tracking-[0.2em] text-leaf-600">Caso selecionado</p><h2 className="mt-2 text-3xl font-black text-slate-950">{selectedCase.crop}</h2><p className="mt-1 text-sm text-slate-500">{text(selectedCase.farm?.name)} · {[selectedCase.farm?.city, selectedCase.farm?.state].filter(Boolean).join("/") || "Localização não informada"}</p></div>
                    <div className="flex flex-wrap gap-2"><RiskBadge riskLevel={selectedCase.risk_level} /><StatusBadge status={selectedCase.status} label={statusLabels[selectedCase.status || ""] ?? selectedCase.status ?? "Sem status"} /></div>
                  </div>
                  <div className="mt-6 grid gap-3 md:grid-cols-4"><DetailBlock label="Área" value={selectedCase.farm?.area_hectares ? `${selectedCase.farm.area_hectares} ha` : null} /><DetailBlock label="Tipo de solo" value={selectedCase.farm?.soil_type} /><DetailBlock label="Estágio" value={selectedCase.growth_stage} /><DetailBlock label="Última atualização" value={formatDate(selectedListItem?.updated_at ?? selectedCase.created_at)} /></div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2"><DetailBlock label="Sintomas" value={selectedCase.symptoms} /><DetailBlock label="Histórico operacional" value={selectedCase.history} /></div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button onClick={() => handleGenerateAnalysis()} disabled={generating} className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white shadow-soft disabled:bg-slate-300">{generating ? "Gerando análise..." : hasAnalysis ? "Gerar nova análise IA" : "Gerar análise IA"}</button>
                    <button onClick={() => requestHumanReview()} disabled={humanReviewingId === selectedId} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-soft disabled:bg-slate-300">{humanReviewingId === selectedId ? "Enviando..." : "Enviar para revisão humana"}</button>
                    <button onClick={() => setShowEdit(true)} className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700">Editar caso completo</button>
                    <button onClick={() => { setDeleteConfirmation(""); setDeleteFeedback(null); setShowDelete(true); }} className="rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700">Excluir</button>
                  </div>
                </div>

                <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="space-y-6">
                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft">
                      <div className="flex items-center justify-between"><h3 className="text-xl font-black">Área principal de análise IA</h3><span className="rounded-full bg-leaf-50 px-3 py-1 text-xs font-bold text-leaf-700">Contexto do caso ativo</span></div>
                      <div className="mt-5 rounded-[1.5rem] bg-slate-950 p-5 text-white"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Resumo da IA</p><p className="mt-3 leading-7 text-slate-100">{analysis?.initialDiagnosis || selectedCase.ai_summary || "Gere uma análise para obter resumo técnico, hipóteses e recomendações iniciais."}</p></div>
                      <div className="mt-5 grid gap-4 md:grid-cols-3"><ListSection title="Hipóteses prováveis" items={analysis?.probableHypotheses ?? []} /><ListSection title="Perguntas pendentes" items={analysis?.missingQuestions ?? (selectedCase.pending_questions ?? []).filter((q) => q.status === "pending").map((q) => q.question)} /><ListSection title="Recomendações iniciais" items={[analysis?.initialRecommendation || selectedCase.ai_recommendation || "Aguardando análise."]} /></div>
                    </div>

                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft">
                      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-black">Interação contextual com IA</h3><div className="flex gap-2"><button onClick={() => setQuestion("Explique as recomendações em linguagem simples.")} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">Explicar</button><button onClick={() => setQuestion("Quais informações faltam para aumentar a confiança da análise?")} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">Perguntas</button></div></div>
                      <div className="mt-5 max-h-[440px] space-y-3 overflow-y-auto rounded-[1.5rem] bg-slate-50 p-4">
                        {chatMessages.length === 0 ? <EmptyState title="Conversa técnica vazia" description="Use a IA para complementar sintomas, interpretar recomendações e continuar a análise do caso atual." /> : chatMessages.map((message, index) => <div key={message.id ?? index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-slate-950 text-white" : "bg-white text-slate-700 shadow-sm"}`}><p className="text-xs font-black uppercase tracking-wide opacity-60">{message.role === "user" ? "Produtor" : "IA agronômica"}</p><p className="mt-1 whitespace-pre-wrap">{message.content}</p></div></div>)}
                        {chatLoading && <div className="text-sm font-bold text-leaf-700">IA processando contexto do caso...</div>}<div ref={chatEndRef} />
                      </div>
                      <form onSubmit={handleAskQuestion} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="Faça uma pergunta complementar mantendo o contexto do caso atual..." className="resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-400" /><button disabled={chatLoading || !question.trim()} className="rounded-2xl bg-leaf-600 px-6 py-3 text-sm font-black text-white disabled:bg-slate-300">Enviar para IA</button></form>
                    </div>
                  </div>

                  <aside className="space-y-6">
                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft"><h3 className="text-xl font-black">Anexos e análise de solo</h3><div className="mt-4 grid grid-cols-2 gap-3">{selectedCase.images?.length ? selectedCase.images.map((image) => <Image key={image.id} src={image.image_url} alt="Anexo do caso" width={220} height={220} className="aspect-square rounded-2xl object-cover" />) : <p className="col-span-2 text-sm text-slate-500">Nenhuma imagem anexada.</p>}</div>{selectedCase.soil_analysis_url && <a href={selectedCase.soil_analysis_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full bg-leaf-50 px-4 py-2 text-sm font-bold text-leaf-700">Abrir análise de solo</a>}</div>
                    <div id="case-timeline" className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft"><h3 className="text-xl font-black">Histórico de análises</h3><div className="mt-5 space-y-4">{(activityLogs.length ? activityLogs : [{ id: "created", action: "Caso criado", created_at: selectedCase.created_at }, ...(selectedCase.ai_summary ? [{ id: "ai", action: "IA analisou", created_at: selectedCase.created_at }] : []), ...(selectedCase.human_review_requested ? [{ id: "human", action: "Revisão humana solicitada", created_at: selectedCase.created_at }] : [])]).map((log) => <div key={log.id} className="flex gap-3"><span className="mt-1 h-3 w-3 rounded-full bg-leaf-600 ring-4 ring-leaf-100" /><div><p className="font-bold text-slate-800">{log.action}</p><p className="text-xs text-slate-500">{formatDate(log.created_at)}</p></div></div>)}</div></div>
                    <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 shadow-soft"><h3 className="text-xl font-black text-amber-950">Revisão humana rápida</h3><p className="mt-2 text-sm leading-6 text-amber-900">Encaminhe casos críticos para validação por especialista. Planos sem permissão veem a oferta comercial automaticamente.</p><button onClick={() => requestHumanReview()} disabled={humanReviewingId === selectedId} className="mt-4 w-full rounded-full bg-amber-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">{humanReviewingId === selectedId ? "Enviando..." : "Enviar para revisão humana"}</button></div>
                  </aside>
                </div>
                <SafetyDisclaimer />
              </>
            ) : null}
          </section>
        </section>
      </div>

      {showEdit && selectedCase && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur"><div className="mx-auto my-8 max-w-4xl rounded-[2rem] bg-white p-6 shadow-soft"><div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black">Editar caso completo</h2><p className="mt-1 text-sm text-slate-500">Atualize cultura, propriedade, área, solo, estágio, sintomas, histórico, imagens e análise de solo.</p></div><button onClick={() => setShowEdit(false)} className="rounded-full bg-slate-100 px-4 py-2 font-bold">Fechar</button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{([ ["crop","Cultura"], ["farmName","Propriedade"], ["city","Cidade"], ["state","Estado"], ["areaHectares","Área (ha)"], ["soilType","Tipo de solo"], ["growthStage","Estágio da cultura"] ] as [keyof EditForm,string][]).map(([key,label]) => <label key={key} className="text-sm font-bold text-slate-700">{label}<input value={editForm[key]} onChange={(e) => setEditForm((c) => ({ ...c, [key]: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label>)}<label className="md:col-span-2 text-sm font-bold text-slate-700">Sintomas<textarea value={editForm.symptoms} onChange={(e) => setEditForm((c) => ({ ...c, symptoms: e.target.value }))} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label><label className="md:col-span-2 text-sm font-bold text-slate-700">Histórico<textarea value={editForm.managementHistory} onChange={(e) => setEditForm((c) => ({ ...c, managementHistory: e.target.value }))} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label><label className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-700">Adicionar novas imagens<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e: ChangeEvent<HTMLInputElement>) => setNewImages(Array.from(e.target.files ?? []))} className="mt-3 block w-full text-sm font-normal" /></label><label className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-700">Substituir/adicionar análise de solo<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setSoilFile(e.target.files?.[0] ?? null)} className="mt-3 block w-full text-sm font-normal" /></label></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button onClick={() => handleSaveCase(false)} disabled={savingEdit} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-black">Salvar rascunho</button><button onClick={() => hasAnalysis && !window.confirm("Deseja gerar uma nova análise com base nas alterações?") ? handleSaveCase(false) : handleSaveCase(true)} disabled={savingEdit} className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white">Salvar e reenviar para IA</button></div></div></div>}
      {showDelete && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur"><div className="max-w-lg rounded-[2rem] bg-white p-6 shadow-soft"><h2 className="text-2xl font-black">Confirmar exclusão segura</h2><p className="mt-3 text-sm leading-6 text-slate-600">Usaremos soft delete para evitar perda acidental. Digite <strong>EXCLUIR</strong> para confirmar.</p><label className="mt-5 block text-sm font-bold text-slate-700">Palavra de confirmação<input value={deleteConfirmation} onChange={(event) => { setDeleteConfirmation(event.target.value); setDeleteFeedback(event.target.value && event.target.value.trim().toUpperCase() !== "EXCLUIR" ? "A palavra ainda não confere com EXCLUIR." : null); }} disabled={deletingCase} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-red-300" placeholder="EXCLUIR" /></label>{deleteFeedback && <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{deleteFeedback}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={() => { if (!deletingCase) { setShowDelete(false); setDeleteConfirmation(""); setDeleteFeedback(null); } }} disabled={deletingCase} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-black disabled:opacity-60">Cancelar</button><button onClick={handleDelete} disabled={!isDeletingEnabled || deletingCase} className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">{deletingCase ? "Excluindo..." : "Excluir caso"}</button></div></div></div>}
      {showUpsell && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur"><div className="max-w-2xl rounded-[2rem] bg-white p-6 shadow-soft"><h2 className="text-2xl font-black">Revisão humana disponível no Premium</h2><p className="mt-3 text-sm leading-6 text-slate-600">Seu plano atual não possui revisão humana inclusa. Escolha uma opção para encaminhar o caso a um especialista.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="font-black">Revisão avulsa</p><p className="mt-2 text-3xl font-black">R$ 197</p><Link href={`/revisao-humana?caseId=${selectedId}`} className="mt-4 inline-flex rounded-full bg-amber-600 px-5 py-3 text-sm font-black text-white">Contratar avulsa</Link></div><div className="rounded-2xl border border-leaf-200 bg-leaf-50 p-5"><p className="font-black">Premium mensal</p><p className="mt-2 text-3xl font-black">R$ 397</p><Link href="/planos" className="mt-4 inline-flex rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white">Ver Premium</Link></div></div><button onClick={() => setShowUpsell(false)} className="mt-5 rounded-full border border-slate-200 px-5 py-3 text-sm font-black">Fechar</button></div></div>}
      {showActions && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur"><div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-soft"><h2 className="text-xl font-black">Ações do caso</h2><div className="mt-4 grid gap-2">{[["open","Abrir caso"],["edit","Editar caso completo"],["delete","Excluir caso"],["ai","Gerar nova análise IA"],["human","Solicitar revisão humana"],["report","Abrir relatório PDF"],["duplicate","Duplicar caso"],["history","Ver histórico do caso"]].map(([action,label]) => <button key={action} onClick={() => handleAction(action, showActions)} disabled={action === "human" && humanReviewingId === showActions.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-bold hover:border-leaf-300 disabled:opacity-60">{action === "human" && humanReviewingId === showActions.id ? "Enviando para revisão..." : label}</button>)}</div><button onClick={() => setShowActions(null)} className="mt-4 rounded-full bg-slate-100 px-5 py-3 text-sm font-black">Fechar</button></div></div>}
    </main>
  );
}

export default function ConsultoriaIAPage() {
  return <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">Carregando consultoria...</div>}><ConsultoriaIAContent /></Suspense>;
}

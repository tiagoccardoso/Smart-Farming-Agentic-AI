"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MobileImagePicker from "../../components/MobileImagePicker";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import { analyzeAgronomicCase, getAgronomicCase, getAgronomicCases } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase, AgronomicPreAnalysis, AgronomicRiskLevel } from "../../lib/agronomic/case";
import { normalizeAiResponseText, normalizeAiTextFields, splitAiResponseIntoBlocks } from "../../lib/agronomic/ai-response-formatting";

type CaseStatus = "draft" | "submitted" | "ai_analyzed" | "waiting_payment_human_review" | "waiting_human_review" | "human_reviewed" | "completed" | "deleted";
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
  waiting_payment_human_review: "Aguardando pagamento da revisão humana",
  waiting_human_review: "Aguardando revisão humana",
  human_reviewed: "Revisado por especialista",
  completed: "Concluído",
  deleted: "Excluído",
};

const riskLabels: Record<string, string> = { low: "Baixo", medium: "Médio", high: "Alto" };
const confidenceLabels: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
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
  return <div className="rounded-[1.5rem] border border-white/70 bg-white p-4 shadow-soft"><p className="text-xs font-bold uppercase tracking-[0.12em] sm:tracking-[0.18em] text-slate-400">{label}</p><p className={`mt-3 bg-gradient-to-r ${tones[tone]} bg-clip-text text-2xl font-black sm:text-3xl text-transparent`}>{value}</p></div>;
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
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
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

function ListSection({ title, items, tone = "leaf" }: { title: string; items: string[]; tone?: "leaf" | "amber" | "red" | "slate" }) {
  const tones = { leaf: "bg-leaf-50 text-leaf-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-800", slate: "bg-slate-50 text-slate-700" };
  return <div className={`rounded-[1.25rem] p-5 ${tones[tone]}`}><h4 className="font-bold text-slate-950">{title}</h4><ul className="mt-3 space-y-2 text-sm leading-6">{items.length ? items.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{item}</li>) : <li className="text-slate-500">Aguardando geração de análise.</li>}</ul></div>;
}

function levelTone(level?: string | null) {
  if (level === "high") return "red";
  if (level === "medium") return "amber";
  return "leaf";
}

function levelBadgeClass(level?: string | null) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-700";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-leaf-200 bg-leaf-50 text-leaf-700";
}

function ConfidenceBar({ level }: { level?: string | null }) {
  const percent = level === "high" ? 88 : level === "medium" ? 58 : 28;
  return <div><div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.16em] text-slate-400"><span>Confiança</span><span>{confidenceLabels[level ?? ""] ?? "Não informada"}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${level === "high" ? "bg-leaf-600" : level === "medium" ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${percent}%` }} /></div></div>;
}

function internetStatusLabel(status?: string | null) {
  if (status === "success") return "Pesquisa externa realizada";
  if (status === "error") return "Pesquisa externa com instabilidade";
  if (status === "unavailable") return "Pesquisa externa indisponível";
  return "Pesquisa externa pendente";
}

function AnalysisCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-[1.5rem] border border-slate-100 bg-white p-5 shadow-sm"><h4 className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">{title}</h4><div className="mt-3 text-sm leading-7 text-slate-700">{children}</div></section>;
}

function buildSourceMetadataForDisplay(analysis: AgronomicPreAnalysis) {
  const searchSucceeded = analysis.internetResearch?.status === "success";
  const internalKnowledgeUsed = Boolean(analysis.knowledgeUsed?.length);
  const fallbackMetadata = {
    searchAttempted: Boolean(analysis.internetResearch),
    searchSucceeded,
    internalKnowledgeAttempted: true,
    internalKnowledgeUsed,
    internalKnowledgeAvailable: internalKnowledgeUsed,
    modelFallbackUsed: !searchSucceeded && !internalKnowledgeUsed,
    cacheUsed: false,
    sources: searchSucceeded ? analysis.internetResearch?.sources ?? [] : [],
    sourceLabel: searchSucceeded && internalKnowledgeUsed
      ? "Fonte usada: pesquisa na internet + base interna"
      : searchSucceeded
        ? "Fonte usada: pesquisa na internet"
        : internalKnowledgeUsed
          ? "Fonte usada: base interna do sistema"
          : "Fonte usada: conhecimento geral da IA",
    errorMessage: !searchSucceeded ? analysis.internetResearch?.summary : undefined,
  };

  return analysis.sourceMetadata ?? fallbackMetadata;
}

function sourceTransparencyText(analysis: AgronomicPreAnalysis) {
  const metadata = buildSourceMetadataForDisplay(analysis);

  if (metadata.modelFallbackUsed) {
    return "A pesquisa externa não entregou conteúdo aproveitável e nenhum material interno foi usado. Esta resposta foi gerada apenas como triagem com os dados do caso e conhecimento geral da IA.";
  }

  if (!metadata.searchSucceeded && metadata.internalKnowledgeUsed) {
    return "A pesquisa externa falhou ou ficou indisponível. A resposta foi mantida com base interna do sistema e dados do caso, sem considerar a internet como fonte bem-sucedida.";
  }

  if (metadata.searchSucceeded && metadata.internalKnowledgeUsed) {
    return "A resposta combinou pesquisa externa bem-sucedida com materiais relevantes da base interna.";
  }

  if (metadata.searchSucceeded) {
    return "A resposta usou pesquisa externa bem-sucedida. Nenhum material interno relevante foi aplicado nesta análise.";
  }

  return "A resposta mostra as fontes realmente disponíveis nesta execução.";
}

function SourceTransparencyPanel({ analysis }: { analysis: AgronomicPreAnalysis }) {
  const metadata = buildSourceMetadataForDisplay(analysis);
  const tone = metadata.modelFallbackUsed
    ? "border-amber-200 bg-amber-50 text-amber-950"
    : metadata.searchSucceeded
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : "border-sky-200 bg-sky-50 text-sky-950";
  const flags = [
    `Internet: ${metadata.searchSucceeded ? "sucesso" : metadata.searchAttempted ? "sem sucesso" : "não executada"}`,
    `Base interna: ${metadata.internalKnowledgeUsed ? "usada" : metadata.internalKnowledgeAvailable ? "disponível, mas não usada" : "sem conteúdo usado"}`,
    `Conhecimento geral da IA: ${metadata.modelFallbackUsed ? "usado como fallback" : "não usado como única fonte"}`,
    metadata.cacheUsed ? "Cache: análise anterior reutilizada" : "Cache: não usado",
  ];

  return (
    <div className={`mt-5 rounded-[1.5rem] border p-5 ${tone}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">Origem da resposta</p>
      <p className="mt-2 text-base font-black">{metadata.sourceLabel}</p>
      <p className="mt-2 text-sm leading-6">{sourceTransparencyText(analysis)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {flags.map((flag) => <span key={flag} className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold shadow-sm">{flag}</span>)}
      </div>
      {metadata.errorMessage ? <p className="mt-3 text-sm font-semibold opacity-85">Detalhe da pesquisa externa: {metadata.errorMessage}</p> : null}
    </div>
  );
}


function LongTextBlock({ value, className = "" }: { value: string; className?: string }) {
  const blocks = splitAiResponseIntoBlocks(value);

  if (!blocks.length) {
    return null;
  }

  return (
    <div className={`mt-3 space-y-3 break-words leading-7 text-slate-700 ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <p key={`${block.type}-${index}`} className="font-black text-slate-900">{block.text}</p>;
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-2 pl-1">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="flex gap-2">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return <p key={`${block.type}-${index}`}>{block.text}</p>;
      })}
    </div>
  );
}

function buildPopularSummaryForDisplay(analysis: AgronomicPreAnalysis | null, selectedCase: AgronomicCase | null) {
  if (analysis?.popularSummary?.trim()) {
    return normalizeAiResponseText(analysis.popularSummary);
  }

  if (!analysis) {
    return null;
  }

  const summary = [
    analysis.initialDiagnosis,
    analysis.probableHypotheses?.length ? `Principais possibilidades: ${analysis.probableHypotheses.join("; ")}.` : null,
    analysis.productionImpact ? `Impacto possível: ${analysis.productionImpact}` : null,
    analysis.safeInitialRecommendations?.length ? `Próximos passos seguros: ${analysis.safeInitialRecommendations.join("; ")}.` : analysis.initialRecommendation,
    analysis.internetResearch?.summary ? `A pesquisa na internet acrescentou: ${analysis.internetResearch.summary}` : null,
    selectedCase?.ai_summary && selectedCase.ai_summary !== analysis.initialDiagnosis ? selectedCase.ai_summary : null,
  ].filter(Boolean).join("\n\n");

  return normalizeAiResponseText(summary);
}

function buildTechnicalDetailsForDisplay(analysis: AgronomicPreAnalysis | null, selectedCase: AgronomicCase | null) {
  if (analysis?.technicalDetails?.trim()) {
    return normalizeAiResponseText(analysis.technicalDetails);
  }

  if (!analysis) {
    return normalizeAiResponseText(selectedCase?.ai_summary || "Gere uma análise para obter dados técnicos completos.");
  }

  const detailedHypotheses = analysis.detailedHypotheses?.length
    ? analysis.detailedHypotheses.map((hypothesis, index) => [
        `${index + 1}. ${hypothesis.name}: probabilidade ${hypothesis.probability}`,
        `Justificativa: ${hypothesis.justification}`,
        hypothesis.favorableFactors?.length ? `Fatores favoráveis:\n- ${hypothesis.favorableFactors.join("\n- ")}` : null,
        hypothesis.uncertaintyFactors?.length ? `Incertezas:\n- ${hypothesis.uncertaintyFactors.join("\n- ")}` : null,
        hypothesis.potentialImpact ? `Impacto potencial: ${hypothesis.potentialImpact}` : null,
      ].filter(Boolean).join("\n"))
    : analysis.probableHypotheses;

  const details = [
    `Diagnóstico inicial: ${analysis.initialDiagnosis}`,
    `Risco: ${analysis.riskLevel}. Confiança: ${analysis.confidenceLevel}.`,
    `Impacto produtivo: ${analysis.productionImpact}`,
    analysis.visualFindings?.length ? `Achados visuais/relatados:\n- ${analysis.visualFindings.join("\n- ")}` : null,
    analysis.attentionPoints?.length ? `Pontos de atenção:\n- ${analysis.attentionPoints.join("\n- ")}` : null,
    detailedHypotheses?.length ? `Hipóteses detalhadas:\n${detailedHypotheses.join("\n\n")}` : null,
    analysis.possibleCauses?.length ? `Possíveis causas:\n- ${analysis.possibleCauses.join("\n- ")}` : null,
    analysis.safeInitialRecommendations?.length ? `Recomendações seguras:\n- ${analysis.safeInitialRecommendations.join("\n- ")}` : `Recomendação inicial: ${analysis.initialRecommendation}`,
    analysis.internetResearch ? `Pesquisa na internet: ${internetStatusLabel(analysis.internetResearch.status)}\nConsulta: ${analysis.internetResearch.query || "não informada"}\nSíntese: ${analysis.internetResearch.summary || "sem síntese registrada"}` : null,
    analysis.knowledgeUsed?.length ? `Base interna usada:\n- ${analysis.knowledgeUsed.map((item) => `${item.title} (${item.category})`).join("\n- ")}` : "Base interna usada: nenhum conteúdo relevante registrado para esta análise.",
    analysis.whenToCallHumanSpecialist ? `Quando acionar especialista: ${analysis.whenToCallHumanSpecialist}` : null,
    analysis.disclaimer,
  ].filter(Boolean).join("\n\n");

  return normalizeAiResponseText(details);
}

function normalizeAnalysisForDisplay(value?: AgronomicPreAnalysis | null) {
  return value ? normalizeAiTextFields(value) : null;
}

function normalizeCaseAiTextForDisplay(caseData: AgronomicCase): AgronomicCase {
  return {
    ...caseData,
    ai_summary: normalizeAiResponseText(caseData.ai_summary),
    ai_recommendation: normalizeAiResponseText(caseData.ai_recommendation),
    ai_analysis_json: normalizeAnalysisForDisplay(caseData.ai_analysis_json),
    pending_questions: caseData.pending_questions?.map((item) => ({
      ...item,
      question: normalizeAiResponseText(item.question),
      answer: normalizeAiResponseText(item.answer),
    })),
    chat_messages: caseData.chat_messages?.map((message) => ({
      ...message,
      message: normalizeAiResponseText(message.message),
    })),
  };
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
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
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
  const [attachmentsState, setAttachmentsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [brokenAttachmentIds, setBrokenAttachmentIds] = useState<Record<string, boolean>>({});
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
    setAttachmentsState({ loading: true, error: null });
    setError(null);
    try {
      const response = await getAgronomicCase(caseId, accessToken) as { case: AgronomicCase; activityLogs?: ActivityLog[] };
      const caseForDisplay = normalizeCaseAiTextForDisplay(response.case);
      setSelectedCase(caseForDisplay);
      const storedAnalysis = normalizeAnalysisForDisplay(caseForDisplay.ai_analysis_json);
      const pendingQuestions = (caseForDisplay.pending_questions ?? []).filter((item) => item.status === "pending").map((item) => item.question);
      const nextAnalysis: AgronomicPreAnalysis | null = storedAnalysis ? {
        ...storedAnalysis,
        missingQuestions: pendingQuestions,
      } : caseForDisplay.ai_summary ? {
        initialDiagnosis: caseForDisplay.ai_summary,
        probableHypotheses: [],
        detailedHypotheses: [],
        visualFindings: ["Análise gerada antes da nova estrutura detalhada; gere uma nova análise para obter leitura visual completa."],
        possibleCauses: [],
        missingQuestions: pendingQuestions,
        riskLevel: caseForDisplay.risk_level ?? "medium",
        confidenceLevel: "medium",
        productionImpact: "Gere uma nova análise para estimar impacto produtivo com mais profundidade.",
        attentionPoints: [],
        initialRecommendation: caseForDisplay.ai_recommendation ?? "Aguardando recomendações da IA.",
        safeInitialRecommendations: caseForDisplay.ai_recommendation ? [caseForDisplay.ai_recommendation] : [],
        whenToCallHumanSpecialist: "Solicite revisão humana como continuidade especializada para decisões de alto impacto agronômico.",
        humanReviewReason: "A revisão humana complementa a triagem da IA quando há risco, incerteza ou necessidade de decisão técnica com responsabilidade profissional.",
        disclaimer: "As orientações geradas por IA são informativas e não substituem avaliação profissional.",
        knowledgeUsed: [],
      } : null;
      setAnalysis(normalizeAnalysisForDisplay(nextAnalysis));
      setChatMessages((caseForDisplay.chat_messages ?? []).map((message) => ({ id: message.id, role: message.role, content: message.message, created_at: message.created_at })));
      setActivityLogs(response.activityLogs ?? []);
      setEditForm({ crop: response.case.crop ?? "", farmName: response.case.farm?.name ?? "", city: response.case.farm?.city ?? "", state: response.case.farm?.state ?? "", areaHectares: response.case.farm?.area_hectares ? String(response.case.farm.area_hectares) : "", soilType: response.case.farm?.soil_type ?? "", growthStage: response.case.growth_stage ?? "", symptoms: response.case.symptoms ?? "", managementHistory: response.case.history ?? "" });
      setBrokenAttachmentIds({});
      setAttachmentsState({ loading: false, error: null });
      router.replace(`/consultoria-ia?caseId=${encodeURIComponent(caseId)}`, { scroll: false });
    } catch (err) { const message = err instanceof Error ? err.message : "Não foi possível abrir o caso."; setError(message); setAttachmentsState({ loading: false, error: "Não foi possível carregar os anexos." }); showToast("error", message); logDevError("Erro ao abrir caso", err); }
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
  const popularSummaryText = useMemo(() => buildPopularSummaryForDisplay(analysis, selectedCase), [analysis, selectedCase]);
  const technicalDetailsText = useMemo(() => buildTechnicalDetailsForDisplay(analysis, selectedCase), [analysis, selectedCase]);

  async function handleGenerateAnalysis(caseId = selectedId) {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !caseId) return;
    setGenerating(true);
    setAnalysisStatus("Pesquisando na internet, consultando a base interna e gerando a resposta técnica...");
    setError(null);
    try {
      const response = await analyzeAgronomicCase(caseId, accessToken);
      setAnalysis(normalizeAnalysisForDisplay(response.analysis));
      await loadCases(caseId);
      await loadSelectedCase(caseId);
    } catch (err) { const message = err instanceof Error ? err.message : "Não foi possível gerar a análise."; setError(message); showToast("error", message); }
    finally { setGenerating(false); setAnalysisStatus(null); }
  }

  async function handleAskQuestion(event: FormEvent) {
    event.preventDefault();
    const accessToken = getStoredSupabaseAccessToken();
    const value = question.trim();
    if (!accessToken || !selectedId || !value) return;
    setQuestion("");
    setChatMessages((current) => [...current, { role: "user", content: value }]);
    setChatLoading(true);
    setChatStatus("Pesquisando na internet, consultando a base interna e atualizando a resposta...");
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(selectedId)}/chat`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: (() => { const data = new FormData(); data.append("message", value); data.append("messageType", "text"); return data; })() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível continuar a conversa.");
      setChatMessages((payload.messages ?? []).map((message: { id: string; role: "user" | "assistant"; message: string; created_at: string | null }) => ({ id: message.id, role: message.role, content: normalizeAiResponseText(message.message), created_at: message.created_at })));
      if (payload.analysis) setAnalysis(normalizeAnalysisForDisplay(payload.analysis));
      await loadSelectedCase(selectedId);
    } catch (err) { const message = err instanceof Error ? err.message : "Erro ao conversar com a IA."; setError(message); showToast("error", message); }
    finally { setChatLoading(false); setChatStatus(null); }
  }

  function handleNewImagesChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);

    if (selectedFiles.length === 0) return;

    const invalidFile = selectedFiles.find(
      (file) => !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type),
    );

    if (invalidFile) {
      showToast("error", `A imagem "${invalidFile.name}" não está em um formato aceito.`);
      return;
    }

    setNewImages((current) => [...current, ...selectedFiles]);
  }

  function handleSoilFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      setSoilFile(null);
      return;
    }

    if (!["application/pdf", "image/jpeg", "image/png"].includes(selectedFile.type)) {
      showToast("error", "Envie a análise de solo em PDF, JPG ou PNG.");
      return;
    }

    setSoilFile(selectedFile);
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
    showToast("success", "Excluindo caso...");
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
      const message = "Erro ao excluir caso.";
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
      showToast("success", "Solicitação criada. Redirecionando para o pagamento da revisão humana.");
      await loadCases(caseId);
      router.push(payload?.redirectTo || `/revisao-humana?caseId=${encodeURIComponent(caseId)}`);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dcfce7_0,transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef7ef_100%)] px-3 py-6 text-slate-900 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-leaf-900 via-leaf-800 to-emerald-700 p-5 text-white shadow-soft sm:p-6 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-leaf-100 ring-1 ring-white/10">Centro operacional</span><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-leaf-800">{plan.label || planLabels[plan.slug]}</span></div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl md:text-5xl">Consultoria Agronômica Inteligente</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-leaf-50 sm:text-base sm:leading-7">Análises organizadas com IA e suporte especializado.</p>
            </div>
            <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 lg:flex lg:justify-end">
              <Link href="/enviar-caso" className="rounded-full bg-white px-5 py-3 text-center text-sm font-black text-leaf-800 shadow-soft transition hover:-translate-y-0.5 hover:bg-leaf-50">Novo Caso</Link>
              <button onClick={() => loadCases(selectedId)} className="rounded-full border border-white/40 px-5 py-3 text-sm font-black text-white hover:bg-white/10">Atualizar</button>
            </div>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-bold uppercase tracking-wide text-leaf-100">Análises restantes no mês</p><p className="mt-2 text-2xl font-black">{plan.remaining === null ? "Ilimitado" : plan.remaining}</p></div>
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-bold uppercase tracking-wide text-leaf-100">Status da assinatura</p><p className="mt-2 text-lg font-black">{plan.subscriptionStatus}</p></div>
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-bold uppercase tracking-wide text-leaf-100">Casos em operação</p><p className="mt-2 text-2xl font-black">{stats.pending}</p></div>
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-bold uppercase tracking-wide text-leaf-100">Risco alto</p><p className="mt-2 text-2xl font-black">{stats.high}</p></div>
          </div>
        </header>

        {toast && <div role="status" className={`rounded-2xl border p-4 text-sm font-semibold ${toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{toast.message}</div>}

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Total de casos" value={stats.total} /><MetricCard label="Revisão humana" value={stats.review} tone="slate" /><MetricCard label="Risco alto" value={stats.high} tone="red" /><MetricCard label="Análises IA" value={cases.filter((item) => item.ai_summary).length} tone="amber" /></section>

        <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] xl:items-start">
          <aside className="space-y-4">
            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-xl font-black">Casos enviados</h2><span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Paginação · 25 por página</span></div>
              <div className="mt-4 grid gap-3">
                <input value={filters.q} onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))} placeholder="Buscar por cultura, propriedade, cidade, sintomas..." className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-400" />
                <div className="grid gap-2 sm:grid-cols-2">
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
                    <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.2em] text-leaf-600">Caso selecionado</p><h2 className="mt-2 break-words text-2xl font-black text-slate-950 sm:text-3xl">{selectedCase.crop}</h2><p className="mt-1 text-sm text-slate-500">{text(selectedCase.farm?.name)} · {[selectedCase.farm?.city, selectedCase.farm?.state].filter(Boolean).join("/") || "Localização não informada"}</p></div>
                    <div className="flex flex-wrap gap-2"><RiskBadge riskLevel={selectedCase.risk_level} /><StatusBadge status={selectedCase.status} label={statusLabels[selectedCase.status || ""] ?? selectedCase.status ?? "Sem status"} /></div>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DetailBlock label="Área" value={selectedCase.farm?.area_hectares ? `${selectedCase.farm.area_hectares} ha` : null} /><DetailBlock label="Tipo de solo" value={selectedCase.farm?.soil_type} /><DetailBlock label="Estágio" value={selectedCase.growth_stage} /><DetailBlock label="Última atualização" value={formatDate(selectedListItem?.updated_at ?? selectedCase.created_at)} /></div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2"><DetailBlock label="Sintomas" value={selectedCase.symptoms} /><DetailBlock label="Histórico operacional" value={selectedCase.history} /></div>
                  <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap">
                    <button onClick={() => handleGenerateAnalysis()} disabled={generating} className="w-full rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white shadow-soft disabled:bg-slate-300 sm:w-auto">{generating ? "Pesquisando e gerando..." : hasAnalysis ? "Gerar nova análise IA" : "Gerar análise IA"}</button>
                    <button onClick={() => requestHumanReview()} disabled={humanReviewingId === selectedId} className="w-full rounded-full bg-leaf-700 px-5 py-3 text-sm font-black text-white shadow-soft hover:bg-leaf-800 disabled:bg-slate-300 sm:w-auto">{humanReviewingId === selectedId ? "Enviando..." : "Enviar para revisão humana"}</button>
                    <button onClick={() => setShowEdit(true)} className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 sm:w-auto">Editar caso completo</button>
                    <button onClick={() => { setDeleteConfirmation(""); setDeleteFeedback(null); setShowDelete(true); }} className="w-full rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 sm:w-auto">Excluir</button>
                  </div>
                </div>

                <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="space-y-6">
                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft">
                      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-black">Área principal de análise IA</h3><div className="flex flex-wrap gap-2"><span className="rounded-full bg-leaf-50 px-3 py-1 text-xs font-bold text-leaf-700">Pré-consultoria estruturada</span>{analysis?.internetResearch && <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">{internetStatusLabel(analysis.internetResearch.status)}</span>}{analysis?.knowledgeUsed?.length ? <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">Base interna usada</span> : null}{analysis?.riskLevel && <span className={`rounded-full border px-3 py-1 text-xs font-black ${levelBadgeClass(analysis.riskLevel)}`}>Risco {riskLabels[analysis.riskLevel]}</span>}</div></div>
                      {(generating || analysisStatus) && <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-800">{analysisStatus || "Pesquisando internet, base interna e gerando resposta..."}</div>}
                      {analysis ? <SourceTransparencyPanel analysis={analysis} /> : null}
                      {popularSummaryText ? <div className="mt-5 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-slate-800"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Resumo em linguagem popular</p><LongTextBlock value={popularSummaryText} /></div> : null}
                      <div className="mt-5 rounded-[1.5rem] border border-leaf-100 bg-gradient-to-br from-leaf-50 via-white to-gold-50 p-5 text-slate-800"><p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">Dados técnicos</p><LongTextBlock value={technicalDetailsText} /></div>
                      {analysis ? <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-[1.25rem] border border-slate-100 bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Nível de risco</p><p className={`mt-3 inline-flex rounded-full border px-4 py-2 text-sm font-black ${levelBadgeClass(analysis.riskLevel)}`}>{riskLabels[analysis.riskLevel]}</p><p className="mt-3 text-sm leading-6 text-slate-600">{analysis.productionImpact}</p></div><div className="rounded-[1.25rem] border border-slate-100 bg-slate-50 p-5"><ConfidenceBar level={analysis.confidenceLevel} /><p className="mt-4 text-sm leading-6 text-slate-600">A confiança considera qualidade das imagens, dados de manejo, estágio, histórico, solo, clima e necessidade de confirmação em campo.</p></div><div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Revisão humana</p><p className="mt-3 text-sm leading-6 text-amber-900">{analysis.humanReviewReason || analysis.whenToCallHumanSpecialist}</p></div></div> : null}
                      {analysis ? <div className="mt-5 grid gap-4 xl:grid-cols-2"><AnalysisCard title="O que foi identificado visualmente"><ul className="space-y-2">{analysis.visualFindings.map((item) => <li key={item} className="flex gap-2"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600" />{item}</li>)}</ul></AnalysisCard><AnalysisCard title="Pontos que chamaram atenção"><ul className="space-y-2">{analysis.attentionPoints.map((item) => <li key={item} className="flex gap-2"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{item}</li>)}</ul></AnalysisCard></div> : null}
                      {analysis?.detailedHypotheses?.length ? <div className="mt-5 space-y-4"><div><h4 className="text-lg font-black text-slate-950">Hipóteses prováveis detalhadas</h4><p className="mt-1 text-sm text-slate-500">Cada hipótese mostra o raciocínio técnico, fatores que favorecem, dúvidas e impacto potencial.</p></div>{analysis.detailedHypotheses.map((hypothesis) => <article key={`${hypothesis.name}-${hypothesis.probability}`} className="rounded-[1.5rem] border border-slate-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h5 className="text-lg font-black text-slate-950">{hypothesis.name}</h5><p className="mt-2 text-sm leading-7 text-slate-700">{hypothesis.justification}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${levelBadgeClass(hypothesis.probability)}`}>Probabilidade {confidenceLabels[hypothesis.probability]}</span></div><div className="mt-4 grid gap-4 md:grid-cols-3"><ListSection title="O que favorece" items={hypothesis.favorableFactors} tone="leaf" /><ListSection title="O que reduz confiança" items={hypothesis.uncertaintyFactors} tone="amber" /><div className="rounded-[1.25rem] bg-red-50 p-5 text-red-800"><h6 className="font-bold text-slate-950">Impacto potencial</h6><p className="mt-3 text-sm leading-6">{hypothesis.potentialImpact}</p></div></div></article>)}</div> : <div className="mt-5 grid gap-4 md:grid-cols-3"><ListSection title="Hipóteses prováveis" items={analysis?.probableHypotheses ?? []} /><ListSection title="Perguntas pendentes" items={analysis?.missingQuestions ?? (selectedCase.pending_questions ?? []).filter((q) => q.status === "pending").map((q) => q.question)} /><ListSection title="Recomendações iniciais" items={[analysis?.initialRecommendation || selectedCase.ai_recommendation || "Aguardando análise."]} /></div>}
                      {analysis ? <div className="mt-5 grid gap-4 md:grid-cols-3"><ListSection title="Possíveis causas" items={analysis.possibleCauses} tone="slate" /><ListSection title="Recomendações seguras" items={analysis.safeInitialRecommendations.length ? analysis.safeInitialRecommendations : [analysis.initialRecommendation]} tone="leaf" /><ListSection title="Perguntas pendentes" items={analysis.missingQuestions ?? (selectedCase.pending_questions ?? []).filter((q) => q.status === "pending").map((q) => q.question)} tone="amber" /></div> : null}
                      {analysis ? <div className="mt-5 rounded-[1.25rem] border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Quando acionar especialista</p><p className="mt-3 text-sm leading-7 text-amber-950">{analysis.whenToCallHumanSpecialist}</p></div> : null}
                      {analysis ? <div className="mt-5 grid gap-4 xl:grid-cols-2"><AnalysisCard title="Pesquisa na internet"><p className="font-bold text-slate-800">{internetStatusLabel(analysis.internetResearch?.status)}</p><p className="mt-2 text-sm leading-7 text-slate-700">{analysis.internetResearch?.summary || "Nenhuma síntese externa registrada para esta análise."}</p>{analysis.internetResearch?.sources?.length ? <ul className="mt-3 space-y-2">{analysis.internetResearch.sources.map((source, index) => <li key={`${source.title}-${index}`} className="text-sm"><a href={source.url || "#"} target={source.url ? "_blank" : undefined} rel={source.url ? "noreferrer" : undefined} className="font-bold text-leaf-700 underline-offset-4 hover:underline">{source.title || source.url}</a></li>)}</ul> : <p className="mt-3 text-sm font-semibold text-slate-500">Nenhuma fonte externa estruturada foi retornada pelo provedor.</p>}</AnalysisCard><AnalysisCard title="Base interna do sistema"><p className="text-sm leading-7 text-slate-700">{analysis.knowledgeUsed?.length ? "A resposta foi enriquecida com materiais internos relevantes da base specialist_knowledge." : "Nenhum material interno relevante foi encontrado ou utilizado nesta consulta."}</p>{analysis.knowledgeUsed?.length ? <ul className="mt-3 space-y-2">{analysis.knowledgeUsed.map((item) => <li key={`${item.title}-${item.category}`} className="flex gap-2"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-600" /><span><strong>{item.title}</strong> · {item.category}</span></li>)}</ul> : null}</AnalysisCard></div> : null}
                    </div>

                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h3 className="text-xl font-black">Interação contextual com IA</h3><div className="flex flex-wrap gap-2"><button onClick={() => setQuestion("Explique as recomendações em linguagem simples.")} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">Explicar</button><button onClick={() => setQuestion("Quais informações faltam para aumentar a confiança da análise?")} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">Perguntas</button></div></div>
                      <div className="mt-5 max-h-[440px] space-y-3 overflow-y-auto rounded-[1.5rem] bg-slate-50 p-4">
                        {chatMessages.length === 0 ? <EmptyState title="Conversa técnica vazia" description="Use a IA para complementar sintomas, interpretar recomendações e continuar a análise do caso atual." /> : chatMessages.map((message, index) => <div key={message.id ?? index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[82%] ${message.role === "user" ? "bg-leaf-700 text-white" : "bg-white text-slate-700 shadow-sm"}`}><p className="text-xs font-black uppercase tracking-wide opacity-60">{message.role === "user" ? "Produtor" : "IA agronômica"}</p><p className="mt-1 whitespace-pre-wrap">{message.content}</p></div></div>)}
                        {chatLoading && <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-800">{chatStatus || "IA pesquisando internet, consultando base interna e processando contexto do caso..."}</div>}<div ref={chatEndRef} />
                      </div>
                      <form onSubmit={handleAskQuestion} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="Faça uma pergunta complementar mantendo o contexto do caso atual..." className="resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-400" /><button disabled={chatLoading || !question.trim()} className="rounded-2xl bg-leaf-600 px-6 py-3 text-sm font-black text-white disabled:bg-slate-300">Enviar para IA</button></form>
                    </div>
                  </div>

                  <aside className="space-y-6">
                    <div className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft"><h3 className="text-xl font-black">Anexos e análise de solo</h3>{attachmentsState.loading ? <p className="mt-4 text-sm text-slate-500">Carregando anexos...</p> : attachmentsState.error ? <p className="mt-4 text-sm text-red-600">{attachmentsState.error}</p> : <div className="mt-4 space-y-4">{selectedCase.images?.length ? <div className="grid grid-cols-2 gap-3">{selectedCase.images.map((image) => <div key={image.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">{brokenAttachmentIds[image.id] ? <div className="flex aspect-square items-center justify-center p-4 text-center text-xs font-semibold text-slate-600">Não foi possível carregar esta imagem.</div> : <img src={image.image_url} alt="Anexo do caso" className="aspect-square w-full object-cover" loading="lazy" onError={() => setBrokenAttachmentIds((current) => ({ ...current, [image.id]: true }))} />}</div>)}</div> : <p className="text-sm text-slate-500">Nenhum anexo enviado.</p>}{selectedCase.soil_analysis_url ? <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-800">Análise de solo</p><p className="mt-1 text-xs text-slate-500">Tipo: documento/arquivo de solo anexado</p><a href={selectedCase.soil_analysis_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-full bg-leaf-50 px-4 py-2 text-sm font-bold text-leaf-700">Visualizar ou baixar</a></div> : <p className="text-sm text-slate-500">Nenhuma análise de solo enviada.</p>}</div>}</div>
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

      {showEdit && selectedCase && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 backdrop-blur sm:p-4"><div className="mx-auto my-4 max-w-4xl rounded-[2rem] bg-white p-4 shadow-soft sm:my-8 sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black">Editar caso completo</h2><p className="mt-1 text-sm text-slate-500">Atualize cultura, propriedade, área, solo, estágio, sintomas, histórico, imagens e análise de solo.</p></div><button onClick={() => setShowEdit(false)} className="rounded-full bg-slate-100 px-4 py-2 font-bold">Fechar</button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{([ ["crop","Cultura"], ["farmName","Propriedade"], ["city","Cidade"], ["state","Estado"], ["areaHectares","Área (ha)"], ["soilType","Tipo de solo"], ["growthStage","Estágio da cultura"] ] as [keyof EditForm,string][]).map(([key,label]) => <label key={key} className="text-sm font-bold text-slate-700">{label}<input value={editForm[key]} onChange={(e) => setEditForm((c) => ({ ...c, [key]: e.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label>)}<label className="md:col-span-2 text-sm font-bold text-slate-700">Sintomas<textarea value={editForm.symptoms} onChange={(e) => setEditForm((c) => ({ ...c, symptoms: e.target.value }))} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label><label className="md:col-span-2 text-sm font-bold text-slate-700">Histórico<textarea value={editForm.managementHistory} onChange={(e) => setEditForm((c) => ({ ...c, managementHistory: e.target.value }))} rows={4} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-leaf-400" /></label><div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-700"><p>Adicionar novas imagens</p><p className="mt-1 text-xs font-normal text-slate-500">Selecione imagens da galeria ou tire uma foto no celular.</p><MobileImagePicker accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" cameraAccept="image/*" multiple galleryLabel="Selecionar imagens" cameraLabel="Tirar foto" galleryAriaLabel="Selecionar novas imagens do caso" cameraAriaLabel="Tirar nova foto do caso" onGalleryChange={handleNewImagesChange} onCameraChange={handleNewImagesChange} className="mt-3" />{newImages.length > 0 && <div className="mt-3 rounded-xl bg-leaf-50 p-3 text-xs font-semibold text-slate-700">{newImages.length} imagem{newImages.length > 1 ? "s" : ""} selecionada{newImages.length > 1 ? "s" : ""}. <button type="button" onClick={() => setNewImages([])} className="ml-2 font-black text-red-700 underline">Remover</button></div>}</div><div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-700"><p>Substituir/adicionar análise de solo</p><p className="mt-1 text-xs font-normal text-slate-500">Envie PDF/imagem ou tire foto do laudo pelo celular.</p><MobileImagePicker accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" cameraAccept="image/*" galleryLabel="Selecionar PDF ou imagem" cameraLabel="Tirar foto" galleryAriaLabel="Selecionar análise de solo" cameraAriaLabel="Tirar foto da análise de solo" onGalleryChange={handleSoilFileChange} onCameraChange={handleSoilFileChange} className="mt-3" />{soilFile && <div className="mt-3 rounded-xl bg-leaf-50 p-3 text-xs font-semibold text-slate-700">Arquivo selecionado: {soilFile.name}. <button type="button" onClick={() => setSoilFile(null)} className="ml-2 font-black text-red-700 underline">Remover</button></div>}</div></div><div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:justify-end"><button onClick={() => handleSaveCase(false)} disabled={savingEdit} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-black">Salvar rascunho</button><button onClick={() => hasAnalysis && !window.confirm("Deseja gerar uma nova análise com base nas alterações?") ? handleSaveCase(false) : handleSaveCase(true)} disabled={savingEdit} className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white">Salvar e reenviar para IA</button></div></div></div>}
      {showDelete && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur sm:p-4"><div className="w-full max-w-lg rounded-[2rem] bg-white p-4 shadow-soft sm:p-6"><h2 className="text-2xl font-black">Confirmar exclusão segura</h2><p className="mt-3 text-sm leading-6 text-slate-600">Esta ação não poderá ser desfeita. O caso, respostas, registros de revisão e arquivos enviados serão excluídos permanentemente. Digite <strong>EXCLUIR</strong> para confirmar.</p><label className="mt-5 block text-sm font-bold text-slate-700">Palavra de confirmação<input value={deleteConfirmation} onChange={(event) => { setDeleteConfirmation(event.target.value); setDeleteFeedback(event.target.value && event.target.value.trim().toUpperCase() !== "EXCLUIR" ? "A palavra ainda não confere com EXCLUIR." : null); }} disabled={deletingCase} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-red-300" placeholder="EXCLUIR" /></label>{deleteFeedback && <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{deleteFeedback}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={() => { if (!deletingCase) { setShowDelete(false); setDeleteConfirmation(""); setDeleteFeedback(null); } }} disabled={deletingCase} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-black disabled:opacity-60">Cancelar</button><button onClick={handleDelete} disabled={!isDeletingEnabled || deletingCase} className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">{deletingCase ? "Excluindo..." : "Excluir caso"}</button></div></div></div>}
      {showUpsell && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur sm:p-4"><div className="w-full max-w-2xl rounded-[2rem] bg-white p-4 shadow-soft sm:p-6"><h2 className="text-2xl font-black">Revisão humana disponível no Premium</h2><p className="mt-3 text-sm leading-6 text-slate-600">Seu plano atual não possui revisão humana inclusa. Escolha uma opção para encaminhar o caso a um especialista.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="font-black">Revisão avulsa</p><p className="mt-2 text-2xl font-black sm:text-3xl">R$ 197</p><Link href={`/revisao-humana?caseId=${selectedId}`} className="mt-4 inline-flex rounded-full bg-amber-600 px-5 py-3 text-sm font-black text-white">Contratar avulsa</Link></div><div className="rounded-2xl border border-leaf-200 bg-leaf-50 p-5"><p className="font-black">Premium mensal</p><p className="mt-2 text-2xl font-black sm:text-3xl">R$ 397</p><Link href="/planos" className="mt-4 inline-flex rounded-full bg-leaf-600 px-5 py-3 text-sm font-black text-white">Ver Premium</Link></div></div><button onClick={() => setShowUpsell(false)} className="mt-5 rounded-full border border-slate-200 px-5 py-3 text-sm font-black">Fechar</button></div></div>}
      {showActions && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur sm:p-4"><div className="w-full max-w-md rounded-[2rem] bg-white p-4 shadow-soft sm:p-6"><h2 className="text-xl font-black">Ações do caso</h2><div className="mt-4 grid gap-2">{[["open","Abrir caso"],["edit","Editar caso completo"],["delete","Excluir caso"],["ai","Gerar nova análise IA"],["human","Solicitar revisão humana"],["report","Abrir relatório PDF"],["duplicate","Duplicar caso"],["history","Ver histórico do caso"]].map(([action,label]) => <button key={action} onClick={() => handleAction(action, showActions)} disabled={action === "human" && humanReviewingId === showActions.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-bold hover:border-leaf-300 disabled:opacity-60">{action === "human" && humanReviewingId === showActions.id ? "Enviando para revisão..." : label}</button>)}</div><button onClick={() => setShowActions(null)} className="mt-4 rounded-full bg-slate-100 px-5 py-3 text-sm font-black">Fechar</button></div></div>}
    </main>
  );
}

export default function ConsultoriaIAPage() {
  return <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-14 text-sm text-slate-600">Carregando consultoria...</div>}><ConsultoriaIAContent /></Suspense>;
}

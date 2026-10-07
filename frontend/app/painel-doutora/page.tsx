"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import MobileImagePicker from "../../components/MobileImagePicker";
import SectionTitle from "../../components/SectionTitle";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { Badge, RiskBadge } from "../../components/agronomic/StatusBadge";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase } from "../../lib/agronomic/case";
import {
  COMPLETED_REVIEWS_LIMIT,
  EMPTY_REVIEW_FORM,
  getMissingFinalizeFields,
  getReviewBucket,
  isSameReviewForm,
  matchesQueueSearch,
  reviewRowToForm,
  sortQueue,
} from "../../lib/agronomic/review-workflow";
import type {
  HumanReviewRow,
  QueueSort,
  ReviewFormValues,
  ReviewQueueBucket,
} from "../../lib/agronomic/review-workflow";

type QueueReview = HumanReviewRow & {
  is_mine: boolean;
  specialist_name: string | null;
};

type QueueCase = AgronomicCase & {
  review: QueueReview | null;
};

type SpecialistQueueResponse = {
  cases: QueueCase[];
  role: "specialist" | "admin";
  currentUserId: string;
};

type ReviewAction = "draft" | "finalize" | "generate_report";

type ReviewForm = ReviewFormValues;

type ReviewResponse = {
  reviewId: string;
  reportId?: string | null;
  status: string;
  review: HumanReviewRow;
  savedAt: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type SortChoice = "default" | QueueSort;

type KnowledgeCategory =
  | "protocolo"
  | "artigo"
  | "aula"
  | "recomendacao"
  | "faq"
  | "caso_pratico"
  | "manejo"
  | "solo"
  | "pragas"
  | "doencas";

type KnowledgeMaterial = {
  id: string;
  title: string | null;
  category: KnowledgeCategory | null;
  crop: string | null;
  content: string | null;
  file_url: string | null;
  created_by: string | null;
  active: boolean | null;
  created_at: string | null;
};

type KnowledgeForm = {
  title: string;
  category: KnowledgeCategory;
  crop: string;
  content: string;
  file_url: string;
  active: boolean;
};

type KnowledgeFilters = {
  crop: string;
  category: "" | KnowledgeCategory;
};

type KnowledgeResponse = {
  materials: KnowledgeMaterial[];
  role: "specialist" | "admin";
};

type KnowledgeMutationResponse = {
  material: KnowledgeMaterial | null;
};

type KnowledgeUploadResponse = {
  fileUrl: string;
  fileName: string;
};

const knowledgeCategories: Array<{ value: KnowledgeCategory; label: string }> =
  [
    { value: "protocolo", label: "Protocolo" },
    { value: "artigo", label: "Artigo" },
    { value: "aula", label: "Aula" },
    { value: "recomendacao", label: "Recomendação" },
    { value: "faq", label: "FAQ" },
    { value: "caso_pratico", label: "Caso prático" },
    { value: "manejo", label: "Manejo" },
    { value: "solo", label: "Solo" },
    { value: "pragas", label: "Pragas" },
    { value: "doencas", label: "Doenças" },
  ];

const emptyKnowledgeForm: KnowledgeForm = {
  title: "",
  category: "protocolo",
  crop: "",
  content: "",
  file_url: "",
  active: true,
};

function parseResponse(response: Response) {
  return response
    .json()
    .catch(() => null)
    .then((payload) => {
      if (!response.ok) {
        throw new Error(
          payload?.error ||
            payload?.message ||
            "A solicitação não pôde ser concluída.",
        );
      }

      return payload;
    });
}

async function getSpecialistQueue(accessToken: string) {
  const response = await fetch("/api/specialist/human-review-cases", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return parseResponse(response) as Promise<SpecialistQueueResponse>;
}

class ReviewRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function submitHumanReview(
  caseId: string,
  form: ReviewForm,
  action: ReviewAction,
  accessToken: string,
) {
  let response: Response;

  try {
    response = await fetch("/api/specialist/human-reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ caseId, ...form, action }),
    });
  } catch {
    // status 0 = falha de rede (sem resposta do servidor).
    throw new ReviewRequestError(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
      0,
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ReviewRequestError(
      payload?.error ||
        payload?.message ||
        "A solicitação não pôde ser concluída.",
      response.status,
    );
  }

  return payload as ReviewResponse;
}

const queueTabs: Array<{
  key: ReviewQueueBucket;
  label: string;
  emptyTitle: string;
  emptyText: string;
}> = [
  {
    key: "pending",
    label: "Pendentes",
    emptyTitle: "Nenhum caso aguardando revisão",
    emptyText:
      "Quando um produtor solicitar um parecer agronômico, o caso aparecerá aqui.",
  },
  {
    key: "draft",
    label: "Rascunhos",
    emptyTitle: "Nenhum rascunho em andamento",
    emptyText:
      "Pareceres salvos como rascunho ficam aqui até serem finalizados.",
  },
  {
    key: "completed",
    label: "Concluídos",
    emptyTitle: "Nenhum parecer concluído recentemente",
    emptyText: `Os ${COMPLETED_REVIEWS_LIMIT} pareceres finalizados mais recentes aparecem aqui.`,
  },
];

const defaultSortByTab: Record<ReviewQueueBucket, QueueSort> = {
  pending: "oldest",
  draft: "updated",
  completed: "updated",
};

const sortOptions: Array<{ value: SortChoice; label: string }> = [
  { value: "default", label: "Ordem padrão da aba" },
  { value: "oldest", label: "Envio mais antigo" },
  { value: "newest", label: "Envio mais recente" },
  { value: "updated", label: "Última alteração" },
  { value: "risk", label: "Maior risco" },
];

const reviewFields: Array<{
  key: keyof ReviewForm;
  label: string;
  placeholder: string;
  rows: number;
  requiredToFinalize: boolean;
}> = [
  {
    key: "reviewText",
    label: "Revisão técnica",
    placeholder:
      "Registre a interpretação técnica do caso, hipóteses prováveis e pontos de atenção.",
    rows: 6,
    requiredToFinalize: true,
  },
  {
    key: "technicalRecommendation",
    label: "Recomendação técnica",
    placeholder:
      "Descreva próximos passos, monitoramento, coletas e cuidados de manejo.",
    rows: 6,
    requiredToFinalize: true,
  },
  {
    key: "finalObservations",
    label: "Observações finais",
    placeholder:
      "Inclua ressalvas, limites da análise remota e pendências para o produtor.",
    rows: 4,
    requiredToFinalize: false,
  },
];

const BACKUP_PREFIX = "plantasa:painel-doutora:parecer";

function backupKey(userId: string, caseId: string) {
  return `${BACKUP_PREFIX}:${userId}:${caseId}`;
}

// Cópia local apenas do texto em edição (nunca de tokens): protege contra
// sessão expirada, falha de rede ou fechamento acidental antes de salvar.
// É apagada assim que o conteúdo é salvo no sistema.
function readBackup(key: string): ReviewForm | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed.reviewText === "string" &&
      typeof parsed.technicalRecommendation === "string" &&
      typeof parsed.finalObservations === "string"
    ) {
      return {
        reviewText: parsed.reviewText,
        technicalRecommendation: parsed.technicalRecommendation,
        finalObservations: parsed.finalObservations,
      };
    }
  } catch {
    // Armazenamento indisponível ou conteúdo inválido: segue sem backup.
  }

  return null;
}

function writeBackup(key: string, form: ReviewForm) {
  try {
    window.localStorage.setItem(key, JSON.stringify(form));
  } catch {
    // Sem espaço ou armazenamento bloqueado: o salvamento no sistema continua.
  }
}

function clearBackup(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignorado.
  }
}

function getCaseBucket(caseData: QueueCase) {
  return getReviewBucket(caseData.human_review_status);
}

function canEditCase(
  caseData: QueueCase,
  role: "specialist" | "admin" | null,
) {
  if (getCaseBucket(caseData) === "completed" || !getCaseBucket(caseData)) {
    return false;
  }

  if (!caseData.review) return true;

  return caseData.review.is_mine || role === "admin";
}

function getResponsibleLabel(caseData: QueueCase) {
  if (!caseData.review?.specialist_id) return null;
  if (caseData.review.is_mine) return "Você";
  return caseData.review.specialist_name || "Outra especialista";
}

function getCaseActionLabel(
  caseData: QueueCase,
  role: "specialist" | "admin" | null,
) {
  const bucket = getCaseBucket(caseData);

  if (bucket === "completed") return "Ver parecer";
  if (!canEditCase(caseData, role)) return "Visualizar";
  return caseData.review ? "Continuar edição" : "Iniciar parecer";
}

function CaseStatusBadge({ caseData }: { caseData: QueueCase }) {
  const bucket = getCaseBucket(caseData);

  if (bucket === "completed") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
        Concluído
      </Badge>
    );
  }

  if (bucket === "draft") {
    const responsible = getResponsibleLabel(caseData);
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800">
        {responsible && responsible !== "Você"
          ? `Rascunho · ${responsible}`
          : "Rascunho"}
      </Badge>
    );
  }

  return (
    <Badge className="border-purple-200 bg-purple-50 text-purple-800">
      Aguardando revisão
    </Badge>
  );
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();

  return sameDay
    ? `às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(date)}`
    : `em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date)}`;
}

function firstCaseOfTab(
  cases: QueueCase[],
  tab: ReviewQueueBucket,
  sort: SortChoice,
  search: string,
) {
  return (
    sortQueue(
      cases.filter(
        (caseData) =>
          getCaseBucket(caseData) === tab &&
          matchesQueueSearch(caseData, search),
      ),
      sort === "default" ? defaultSortByTab[tab] : sort,
    )[0] ?? null
  );
}

function isQueueBucket(value: string | null): value is ReviewQueueBucket {
  return value === "pending" || value === "draft" || value === "completed";
}

async function getKnowledgeMaterials(
  accessToken: string,
  filters: KnowledgeFilters,
) {
  const params = new URLSearchParams();

  if (filters.crop.trim()) {
    params.set("crop", filters.crop.trim());
  }

  if (filters.category) {
    params.set("category", filters.category);
  }

  const response = await fetch(
    `/api/specialist/knowledge${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  return parseResponse(response) as Promise<KnowledgeResponse>;
}

async function saveKnowledgeMaterial(
  form: KnowledgeForm,
  accessToken: string,
  materialId?: string | null,
) {
  const response = await fetch("/api/specialist/knowledge", {
    method: materialId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ id: materialId, ...form }),
  });

  return parseResponse(response) as Promise<KnowledgeMutationResponse>;
}

async function updateKnowledgeStatus(
  material: KnowledgeMaterial,
  accessToken: string,
) {
  const response = await fetch("/api/specialist/knowledge", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ id: material.id, active: !material.active }),
  });

  return parseResponse(response) as Promise<KnowledgeMutationResponse>;
}

async function uploadKnowledgeFile(file: File, accessToken: string) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/specialist/knowledge/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  return parseResponse(response) as Promise<KnowledgeUploadResponse>;
}

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") {
    return "Não informado";
  }

  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Não informada";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLocation(caseData: AgronomicCase) {
  return (
    [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") ||
    "Cidade/UF não informadas"
  );
}

function getCategoryLabel(category?: KnowledgeCategory | null) {
  return (
    knowledgeCategories.find((item) => item.value === category)?.label ??
    "Sem categoria"
  );
}

function buildPendingQuestions(caseData: AgronomicCase) {
  const questions = [
    "Qual porcentagem aproximada do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou de forma uniforme?",
    "Houve aplicação, chuva intensa, irrigação, geada ou calor extremo nos últimos 7 a 14 dias?",
  ];

  if (!caseData.history) {
    questions.push(
      "Quais manejos, adubações e pulverizações foram feitos recentemente?",
    );
  }

  if (caseData.images.length === 0) {
    questions.push(
      "É possível anexar fotos próximas dos sintomas e imagens gerais da lavoura?",
    );
  }

  if (!caseData.soil_analysis_url) {
    questions.push(
      "Existe análise de solo recente com pH, matéria orgânica, macro e micronutrientes?",
    );
  }

  return questions;
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900">
        {displayValue(value)}
      </p>
    </div>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <div className="mt-4 text-sm leading-6 text-slate-700">{children}</div>
    </article>
  );
}

export default function PainelDoutoraPage() {
  const [cases, setCases] = useState<QueueCase[]>([]);
  const [role, setRole] = useState<"specialist" | "admin" | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewQueueBucket>("pending");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChoice>("default");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<ReviewAction | null>(null);
  // Trava síncrona contra duplo clique (o estado do React só muda no próximo render).
  const submittingRef = useRef(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewForm>(EMPTY_REVIEW_FORM);
  const [savedForm, setSavedForm] = useState<ReviewForm>(EMPTY_REVIEW_FORM);
  const [loadedCaseId, setLoadedCaseId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [restoredFromBackup, setRestoredFromBackup] = useState(false);
  const [missingFields, setMissingFields] = useState<Array<keyof ReviewForm>>(
    [],
  );
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const saveDraftRef = useRef<() => boolean>(() => false);
  const [knowledgeMaterials, setKnowledgeMaterials] = useState<
    KnowledgeMaterial[]
  >([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);
  const [knowledgeStatusId, setKnowledgeStatusId] = useState<string | null>(
    null,
  );
  const [editingKnowledgeId, setEditingKnowledgeId] = useState<string | null>(
    null,
  );
  const [knowledgeForm, setKnowledgeForm] =
    useState<KnowledgeForm>(emptyKnowledgeForm);
  const [knowledgeFilters, setKnowledgeFilters] = useState<KnowledgeFilters>({
    crop: "",
    category: "",
  });
  const [selectedKnowledgeFile, setSelectedKnowledgeFile] = useState<File | null>(null);
  const [uploadingKnowledgeFile, setUploadingKnowledgeFile] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("Nenhum arquivo enviado.");
  const [showKnowledge, setShowKnowledge] = useState(false);

  const selectedCase = useMemo(
    () => cases.find((caseData) => caseData.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );
  const selectedBucket = selectedCase ? getCaseBucket(selectedCase) : null;
  const editable = selectedCase ? canEditCase(selectedCase, role) : false;
  const formMatchesSelection = loadedCaseId === selectedCase?.id;
  const isDirty =
    editable && formMatchesSelection && !isSameReviewForm(form, savedForm);
  const pendingQuestions = useMemo(
    () => (selectedCase ? buildPendingQuestions(selectedCase) : []),
    [selectedCase],
  );
  const counts = useMemo(() => {
    const result: Record<ReviewQueueBucket, number> = {
      pending: 0,
      draft: 0,
      completed: 0,
    };
    cases.forEach((caseData) => {
      const bucket = getCaseBucket(caseData);
      if (bucket) result[bucket] += 1;
    });
    return result;
  }, [cases]);
  const myDraftCount = useMemo(
    () =>
      cases.filter(
        (caseData) =>
          getCaseBucket(caseData) === "draft" &&
          canEditCase(caseData, role) &&
          (caseData.review?.is_mine || !caseData.review),
      ).length,
    [cases, role],
  );
  const effectiveSort: QueueSort =
    sort === "default" ? defaultSortByTab[activeTab] : sort;
  const visibleCases = useMemo(
    () =>
      sortQueue(
        cases.filter(
          (caseData) =>
            getCaseBucket(caseData) === activeTab &&
            matchesQueueSearch(caseData, search),
        ),
        effectiveSort,
      ),
    [cases, activeTab, search, effectiveSort],
  );
  const highRiskCount = visibleCases.filter(
    (caseData) => caseData.risk_level === "high",
  ).length;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setShowKnowledge(false);
    }
  }, []);

  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      setLoadError(null);
      setAccessDenied(false);

      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setAccessDenied(true);
        setLoading(false);
        setKnowledgeLoading(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const requestedCaseId = params.get("caso");
      const requestedTab = params.get("aba");

      try {
        // A base de conhecimento não deve impedir o carregamento da fila.
        const [queueResult, knowledgeResult] = await Promise.allSettled([
          getSpecialistQueue(accessToken),
          getKnowledgeMaterials(accessToken, { crop: "", category: "" }),
        ]);

        if (knowledgeResult.status === "fulfilled") {
          setKnowledgeMaterials(knowledgeResult.value.materials);
        }

        if (queueResult.status === "rejected") {
          throw queueResult.reason;
        }

        const queue = queueResult.value;
        setCases(queue.cases);
        setRole(queue.role);
        setCurrentUserId(queue.currentUserId);

        const requestedCase = queue.cases.find(
          (caseData) => caseData.id === requestedCaseId,
        );
        const hasPending = queue.cases.some(
          (caseData) => getCaseBucket(caseData) === "pending",
        );
        const hasDrafts = queue.cases.some(
          (caseData) => getCaseBucket(caseData) === "draft",
        );
        const initialTab: ReviewQueueBucket =
          (requestedCase && getCaseBucket(requestedCase)) ||
          (isQueueBucket(requestedTab) ? requestedTab : null) ||
          (hasPending ? "pending" : hasDrafts ? "draft" : "pending");

        setActiveTab(initialTab);
        setSelectedCaseId(
          requestedCase?.id ??
            firstCaseOfTab(queue.cases, initialTab, "default", "")?.id ??
            null,
        );
      } catch (loadFailure) {
        const message =
          loadFailure instanceof Error
            ? loadFailure.message
            : "Não foi possível carregar a fila da especialista.";

        if (message.toLowerCase().includes("acesso negado")) {
          setAccessDenied(true);
        } else {
          setLoadError(message);
        }
      } finally {
        setLoading(false);
        setKnowledgeLoading(false);
      }
    }

    loadInitialData();
  }, []);

  // Carrega o parecer salvo (ou a cópia local não salva) ao trocar de caso.
  // Depende só da troca de seleção para não sobrescrever o texto em edição
  // quando a lista é atualizada.
  useEffect(() => {
    if (!selectedCase) {
      if (loadedCaseId !== null) {
        setLoadedCaseId(null);
        setForm(EMPTY_REVIEW_FORM);
        setSavedForm(EMPTY_REVIEW_FORM);
      }
      return;
    }

    if (selectedCase.id === loadedCaseId) return;

    const baseline = reviewRowToForm(selectedCase.review);
    let initialForm = baseline;
    let restored = false;

    if (currentUserId && canEditCase(selectedCase, role)) {
      const key = backupKey(currentUserId, selectedCase.id);
      const backup = readBackup(key);

      if (backup && !isSameReviewForm(backup, baseline)) {
        initialForm = backup;
        restored = true;
      } else if (backup) {
        clearBackup(key);
      }
    }

    setForm(initialForm);
    setSavedForm(baseline);
    setLoadedCaseId(selectedCase.id);
    setRestoredFromBackup(restored);
    setSaveState("idle");
    setLastSavedAt(
      selectedCase.review?.status === "in_review"
        ? (selectedCase.updated_at ?? selectedCase.review.created_at ?? null)
        : null,
    );
    setMissingFields([]);
    setReviewError(null);
    setConfirmingFinalize(false);
  }, [selectedCase, loadedCaseId, currentUserId, role]);

  // Mantém a cópia local enquanto houver alterações não salvas.
  useEffect(() => {
    if (!currentUserId || !loadedCaseId || !editable || !formMatchesSelection) {
      return;
    }

    const key = backupKey(currentUserId, loadedCaseId);

    if (!isDirty) {
      clearBackup(key);
      return;
    }

    const timer = window.setTimeout(() => writeBackup(key, form), 500);
    return () => window.clearTimeout(timer);
  }, [form, isDirty, editable, formMatchesSelection, currentUserId, loadedCaseId]);

  // Avisa antes de fechar/atualizar a página com alterações não salvas.
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Caso e aba ficam na URL: atualizar a página reabre o mesmo parecer.
  useEffect(() => {
    if (loading || accessDenied) return;

    const url = new URL(window.location.href);
    url.searchParams.set("aba", activeTab);

    if (selectedCaseId) {
      url.searchParams.set("caso", selectedCaseId);
    } else {
      url.searchParams.delete("caso");
    }

    window.history.replaceState(window.history.state, "", url.toString());
  }, [activeTab, selectedCaseId, loading, accessDenied]);

  // Ctrl/Cmd + S salva o rascunho.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        if (saveDraftRef.current()) event.preventDefault();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function updateForm(field: keyof ReviewForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setMissingFields((current) => current.filter((item) => item !== field));
    if (saveState === "saved") setSaveState("idle");
  }

  function confirmLeaveIfDirty() {
    if (!isDirty) return true;

    return window.confirm(
      "Este parecer tem alterações que ainda não foram salvas no sistema (uma cópia fica guardada neste navegador). Deseja sair mesmo assim?",
    );
  }

  function scrollToDetail() {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }

  function selectCase(caseId: string) {
    if (submittingRef.current) return;

    if (caseId === selectedCaseId) {
      scrollToDetail();
      return;
    }

    if (!confirmLeaveIfDirty()) return;

    setSelectedCaseId(caseId);
    setReviewNotice(null);
    scrollToDetail();
  }

  function changeTab(tab: ReviewQueueBucket) {
    if (tab === activeTab || submittingRef.current) return;

    if (selectedCase && getCaseBucket(selectedCase) === tab) {
      setActiveTab(tab);
      return;
    }

    if (!confirmLeaveIfDirty()) return;

    setActiveTab(tab);
    setSelectedCaseId(firstCaseOfTab(cases, tab, sort, search)?.id ?? null);
    setReviewNotice(null);
  }

  async function refreshQueue() {
    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setLoadError("Sua sessão expirou. Entre novamente para atualizar a fila.");
      return;
    }

    setRefreshing(true);
    setLoadError(null);

    try {
      const queue = await getSpecialistQueue(accessToken);
      setCases(queue.cases);
      setRole(queue.role);
      setCurrentUserId(queue.currentUserId);

      if (!queue.cases.some((caseData) => caseData.id === selectedCaseId)) {
        setSelectedCaseId(
          firstCaseOfTab(queue.cases, activeTab, sort, search)?.id ?? null,
        );
      }
    } catch (refreshFailure) {
      setLoadError(
        refreshFailure instanceof Error
          ? refreshFailure.message
          : "Não foi possível atualizar a fila.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  function discardLocalChanges() {
    setForm(savedForm);
    setRestoredFromBackup(false);
    setMissingFields([]);

    if (currentUserId && loadedCaseId) {
      clearBackup(backupKey(currentUserId, loadedCaseId));
    }
  }

  function openFinalizeDialog() {
    const missing = getMissingFinalizeFields(form);

    if (missing.length > 0) {
      setMissingFields(missing);
      setReviewError(
        `Preencha ${missing
          .map((field) => reviewFields.find((item) => item.key === field)?.label)
          .join(" e ")} antes de finalizar.`,
      );
      document.getElementById(`parecer-${missing[0]}`)?.focus();
      return;
    }

    setReviewError(null);
    setConfirmingFinalize(true);
  }

  async function runReviewAction(action: ReviewAction) {
    if (!selectedCase || !editable || submittingRef.current) return;

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setSaveState("error");
      setConfirmingFinalize(false);
      setReviewError(
        "Sua sessão expirou. Entre novamente para salvar — o texto continua guardado neste navegador.",
      );
      return;
    }

    if (action !== "draft" && getMissingFinalizeFields(form).length > 0) {
      setConfirmingFinalize(false);
      openFinalizeDialog();
      return;
    }

    const caseId = selectedCase.id;
    const snapshot = form;

    submittingRef.current = true;
    setSubmitting(action);
    setSaveState("saving");
    setReviewError(null);
    setReviewNotice(null);

    try {
      const response = await submitHumanReview(
        caseId,
        snapshot,
        action,
        accessToken,
      );
      const savedReview: QueueReview = {
        ...response.review,
        is_mine: response.review.specialist_id === currentUserId,
        specialist_name: selectedCase.review?.specialist_name ?? null,
      };

      setCases((current) =>
        current.map((caseData) =>
          caseData.id === caseId
            ? {
                ...caseData,
                human_review_status: action === "draft" ? "in_review" : "reviewed",
                status: action === "draft" ? caseData.status : "human_reviewed",
                updated_at: response.savedAt,
                review: savedReview,
              }
            : caseData,
        ),
      );
      setSavedForm(snapshot);
      setLastSavedAt(response.savedAt);
      setSaveState("saved");
      setRestoredFromBackup(false);
      setMissingFields([]);

      if (action === "draft") {
        setActiveTab("draft");
        setReviewNotice(
          `Rascunho salvo ${formatSavedAt(response.savedAt)}. Ele fica na aba Rascunhos até você finalizar.`,
        );
      } else {
        setConfirmingFinalize(false);
        setActiveTab("completed");
        setReviewNotice(
          action === "generate_report"
            ? "Parecer finalizado e relatório preparado. O produtor já pode consultá-lo em Meus Relatórios."
            : "Parecer finalizado. O produtor já pode consultá-lo em Meus Relatórios.",
        );

        if (currentUserId) clearBackup(backupKey(currentUserId, caseId));
      }
    } catch (saveFailure) {
      const status =
        saveFailure instanceof ReviewRequestError ? saveFailure.status : 500;
      const baseMessage =
        saveFailure instanceof Error
          ? saveFailure.message
          : "Não foi possível salvar o parecer.";

      setSaveState("error");
      setConfirmingFinalize(false);
      setReviewError(
        status === 401
          ? "Sua sessão expirou. Entre novamente para salvar — o texto continua guardado neste navegador."
          : `${baseMessage} O texto continua guardado neste navegador.`,
      );

      // Conflito (outra especialista ou parecer já finalizado): sincroniza a fila.
      if (status === 409) void refreshQueue();
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  }

  saveDraftRef.current = () => {
    if (!editable || !isDirty || submittingRef.current) return false;
    void runReviewAction("draft");
    return true;
  };

  const saveStatus = (() => {
    if (submitting === "draft") {
      return { text: "Salvando rascunho...", tone: "text-slate-600" };
    }
    if (submitting) {
      return { text: "Finalizando parecer...", tone: "text-slate-600" };
    }
    if (saveState === "error" && isDirty) {
      return {
        text: "Não foi possível salvar. O texto continua neste navegador.",
        tone: "text-red-700",
      };
    }
    if (isDirty) {
      return { text: "Alterações não salvas", tone: "text-amber-700" };
    }
    if (lastSavedAt) {
      return {
        text: `Rascunho salvo ${formatSavedAt(lastSavedAt)}`,
        tone: "text-emerald-700",
      };
    }
    return { text: "Nenhuma alteração ainda", tone: "text-slate-500" };
  })();

  function updateKnowledgeForm(
    field: keyof KnowledgeForm,
    value: string | boolean,
  ) {
    setKnowledgeForm((current) => ({ ...current, [field]: value }));
  }

  async function reloadKnowledge(filters = knowledgeFilters) {
    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setKnowledgeLoading(true);
    setError(null);

    try {
      const response = await getKnowledgeMaterials(accessToken, filters);
      setKnowledgeMaterials(response.materials);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar a base de conhecimento.",
      );
    } finally {
      setKnowledgeLoading(false);
    }
  }

  function handleKnowledgeEdit(material: KnowledgeMaterial) {
    setEditingKnowledgeId(material.id);
    setKnowledgeForm({
      title: material.title ?? "",
      category: material.category ?? "protocolo",
      crop: material.crop ?? "",
      content: material.content ?? "",
      file_url: material.file_url ?? "",
      active: material.active ?? true,
    });
  }

  function resetKnowledgeForm() {
    setEditingKnowledgeId(null);
    setKnowledgeForm(emptyKnowledgeForm);
  }

  async function handleKnowledgeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setKnowledgeSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await saveKnowledgeMaterial(
        knowledgeForm,
        accessToken,
        editingKnowledgeId,
      );

      if (response.material) {
        setKnowledgeMaterials((current) => {
          const withoutUpdated = current.filter(
            (material) => material.id !== response.material?.id,
          );
          return [response.material as KnowledgeMaterial, ...withoutUpdated];
        });
      }

      setSuccessMessage(
        editingKnowledgeId
          ? "Conteúdo técnico atualizado na base de conhecimento."
          : "Conteúdo técnico cadastrado na base de conhecimento.",
      );
      resetKnowledgeForm();
      await reloadKnowledge();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível salvar o conteúdo técnico.",
      );
    } finally {
      setKnowledgeSubmitting(false);
    }
  }

  async function handleKnowledgeFileUpload() {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) {
      setAccessDenied(true);
      return;
    }
    if (!selectedKnowledgeFile) {
      setUploadStatus("Selecione um arquivo antes de enviar.");
      return;
    }

    setUploadingKnowledgeFile(true);
    setError(null);
    setSuccessMessage(null);
    setUploadStatus("Enviando arquivo...");

    try {
      const response = await uploadKnowledgeFile(selectedKnowledgeFile, accessToken);
      setKnowledgeForm((current) => ({ ...current, file_url: response.fileUrl }));
      setUploadStatus(`Upload concluído: ${response.fileName}`);
      setSuccessMessage("Arquivo enviado com sucesso. Agora finalize o cadastro do conteúdo.");
      setSelectedKnowledgeFile(null);
    } catch (uploadError) {
      setUploadStatus("Erro no envio do arquivo.");
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploadingKnowledgeFile(false);
    }
  }

  async function handleKnowledgeToggle(material: KnowledgeMaterial) {
    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setKnowledgeStatusId(material.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await updateKnowledgeStatus(material, accessToken);

      if (response.material) {
        setKnowledgeMaterials((current) =>
          current.map((item) =>
            item.id === response.material?.id
              ? (response.material as KnowledgeMaterial)
              : item,
          ),
        );
      }

      setSuccessMessage(
        material.active ? "Conteúdo desativado." : "Conteúdo ativado.",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível alterar o status do conteúdo.",
      );
    } finally {
      setKnowledgeStatusId(null);
    }
  }

  async function handleKnowledgeFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await reloadKnowledge(knowledgeFilters);
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-14 lg:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Área técnica da especialista
        </p>
        <SectionTitle
          title="Painel da Doutora"
          subtitle="Revise casos, salve rascunhos e finalize pareceres agronômicos."
        />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Acompanhe os casos enviados pelos produtores, confira a pré-análise
          da IA e registre o parecer técnico. Rascunhos ficam salvos até a
          finalização.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
        <Link
          href="/painel-doutora"
          className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft"
        >
          Revisões
        </Link>
        <Link
          href="/painel-doutora/base-conhecimento"
          className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft"
        >
          Base de Conhecimento
        </Link>
      </div>

      {accessDenied && (
        <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft">
          <h2 className="text-lg font-semibold">Acesso negado</h2>
          <p className="mt-2 text-sm leading-6">
            Apenas usuários com role specialist ou admin podem acessar o Painel
            da Doutora.
          </p>
        </div>
      )}

      {!accessDenied && (
        <>
          <WorkflowStepper
            className="mt-8"
            steps={[
              {
                title: "Solicitação recebida",
                description: "Produtor envia o caso pelo plano.",
                status: "done",
              },
              {
                title: "Painel da Doutora",
                description: "Especialista revisa dados e IA.",
                status: counts.pending + counts.draft > 0 ? "current" : "next",
              },
              {
                title: "Finalizar parecer",
                description: "Parecer técnico e recomendações.",
                status: "next",
              },
              {
                title: "Meus Relatórios",
                description: "Usuário acessa o resultado final.",
                status: "next",
              },
            ]}
          />

          {error && (
            <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-soft">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-soft">
              {successMessage}
            </div>
          )}

          {showKnowledge && (<article className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">
                  Materiais da especialista
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  Base de Conhecimento
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Cadastre protocolos, artigos, aulas, FAQs e demais conteúdos
                  técnicos para consulta interna. Embeddings e uso direto pela
                  IA ficarão para uma próxima etapa.
                </p>
              </div>
              {editingKnowledgeId && (
                <button
                  type="button"
                  onClick={resetKnowledgeForm}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar edição
                </button>
              )}
            </div>

            <form
              onSubmit={handleKnowledgeSubmit}
              className="mt-6 grid gap-5 rounded-3xl border border-leaf-100 bg-leaf-50/50 p-5"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    Título
                  </span>
                  <input
                    value={knowledgeForm.title}
                    onChange={(event) =>
                      updateKnowledgeForm("title", event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="Ex.: Protocolo de manejo de ferrugem"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    Categoria
                  </span>
                  <select
                    value={knowledgeForm.category}
                    onChange={(event) =>
                      updateKnowledgeForm(
                        "category",
                        event.target.value as KnowledgeCategory,
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  >
                    {knowledgeCategories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    Cultura
                  </span>
                  <input
                    value={knowledgeForm.crop}
                    onChange={(event) =>
                      updateKnowledgeForm("crop", event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="Ex.: soja, milho, café"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    URL do arquivo
                  </span>
                  <input
                    value={knowledgeForm.file_url}
                    onChange={(event) =>
                      updateKnowledgeForm("file_url", event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
                <div className="block">
                  <span className="text-sm font-semibold text-slate-700">Upload de arquivo local</span>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <MobileImagePicker
                      accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.doc,.docx"
                      cameraAccept="image/*"
                      galleryLabel="Selecionar arquivo"
                      cameraLabel="Tirar foto"
                      galleryAriaLabel="Selecionar arquivo local para a base de conhecimento"
                      cameraAriaLabel="Tirar foto para a base de conhecimento"
                      onGalleryChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setSelectedKnowledgeFile(file);
                        setUploadStatus(file ? `Arquivo selecionado: ${file.name}` : "Nenhum arquivo enviado.");
                      }}
                      onCameraChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setSelectedKnowledgeFile(file);
                        setUploadStatus(file ? `Foto selecionada: ${file.name}` : "Nenhum arquivo enviado.");
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleKnowledgeFileUpload}
                      disabled={uploadingKnowledgeFile}
                      className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {uploadingKnowledgeFile ? "Enviando..." : "Enviar arquivo"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{uploadStatus}</p>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Conteúdo técnico
                </span>
                <textarea
                  value={knowledgeForm.content}
                  onChange={(event) =>
                    updateKnowledgeForm("content", event.target.value)
                  }
                  rows={6}
                  className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  placeholder="Cole ou descreva o conteúdo técnico que deve ficar disponível na base."
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={knowledgeForm.active}
                    onChange={(event) =>
                      updateKnowledgeForm("active", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-leaf-300 text-leaf-600 focus:ring-leaf-500"
                  />
                  Conteúdo ativo
                </label>
                <button
                  type="submit"
                  disabled={knowledgeSubmitting}
                  className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {knowledgeSubmitting
                    ? "Salvando..."
                    : editingKnowledgeId
                      ? "Atualizar conteúdo"
                      : "Cadastrar conteúdo"}
                </button>
              </div>
            </form>

            <form
              onSubmit={handleKnowledgeFilter}
              className="mt-6 grid gap-4 rounded-3xl border border-slate-100 bg-slate-50 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end"
            >
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Filtrar por cultura
                </span>
                <input
                  value={knowledgeFilters.crop}
                  onChange={(event) =>
                    setKnowledgeFilters((current) => ({
                      ...current,
                      crop: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  placeholder="Digite uma cultura"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Filtrar por categoria
                </span>
                <select
                  value={knowledgeFilters.category}
                  onChange={(event) =>
                    setKnowledgeFilters((current) => ({
                      ...current,
                      category: event.target
                        .value as KnowledgeFilters["category"],
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                >
                  <option value="">Todas</option>
                  {knowledgeCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
              >
                Aplicar filtros
              </button>
            </form>

            <div className="mt-6 space-y-4">
              {knowledgeLoading ? (
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 text-sm text-slate-600">
                  Carregando conteúdos técnicos...
                </div>
              ) : knowledgeMaterials.length === 0 ? (
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 text-sm text-slate-600">
                  Nenhum conteúdo encontrado para os filtros selecionados.
                </div>
              ) : (
                knowledgeMaterials.map((material) => (
                  <div
                    key={material.id}
                    className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-leaf-100 px-3 py-1 text-xs font-semibold text-leaf-800">
                            {getCategoryLabel(material.category)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {material.crop || "Cultura geral"}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${material.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}
                          >
                            {material.active ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-slate-900">
                          {material.title || "Sem título"}
                        </h3>
                        <p className="mt-2 text-xs text-slate-500">
                          Criado em {formatDate(material.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleKnowledgeEdit(material)}
                          className="rounded-full border border-leaf-200 px-4 py-2 text-xs font-semibold text-leaf-700 hover:bg-leaf-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleKnowledgeToggle(material)}
                          disabled={knowledgeStatusId === material.id}
                          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {knowledgeStatusId === material.id
                            ? "Alterando..."
                            : material.active
                              ? "Desativar"
                              : "Ativar"}
                        </button>
                      </div>
                    </div>
                    {material.content && (
                      <p className="mt-4 line-clamp-4 whitespace-pre-line text-sm leading-6 text-slate-700">
                        {material.content}
                      </p>
                    )}
                    {material.file_url && (
                      <a
                        href={material.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex rounded-full bg-leaf-600 px-4 py-2 text-xs font-semibold text-white hover:bg-leaf-700"
                      >
                        Abrir arquivo
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </article>)}

          {loading && (
            <div className="mt-8">
              <LoadingCard
                title="Carregando fila da Doutora"
                description="Buscando casos pendentes, rascunhos e pareceres concluídos."
                rows={4}
              />
            </div>
          )}

          {!loading && loadError && cases.length === 0 && (
            <div
              role="alert"
              className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft"
            >
              <h2 className="text-lg font-semibold">
                Não foi possível carregar a fila
              </h2>
              <p className="mt-2 text-sm leading-6">{loadError}</p>
              <button
                type="button"
                onClick={refreshQueue}
                disabled={refreshing}
                className="mt-4 rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {refreshing ? "Tentando novamente..." : "Tentar novamente"}
              </button>
            </div>
          )}

          {!loading && !(loadError && cases.length === 0) && (
            <div className="mt-8">
              {activeTab !== "draft" && myDraftCount > 0 && (
                <div className="mb-6 flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-amber-900">
                    <strong>
                      {myDraftCount === 1
                        ? "1 parecer em rascunho aguarda continuidade."
                        : `${myDraftCount} pareceres em rascunho aguardam continuidade.`}
                    </strong>{" "}
                    Eles ficam salvos até serem finalizados.
                  </p>
                  <button
                    type="button"
                    onClick={() => changeTab("draft")}
                    className="shrink-0 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    Ver rascunhos
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div
                  role="tablist"
                  aria-label="Situação dos pareceres"
                  className="flex w-full gap-1 overflow-x-auto rounded-full border border-leaf-100 bg-white p-1 shadow-soft xl:w-auto"
                >
                  {queueTabs.map((tab) => {
                    const isActive = tab.key === activeTab;
                    const count = counts[tab.key];

                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={`aba-${tab.key}`}
                        aria-selected={isActive}
                        aria-controls="lista-casos"
                        onClick={() => changeTab(tab.key)}
                        className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-300 xl:flex-none ${isActive ? "bg-leaf-600 text-white shadow-soft" : "text-slate-600 hover:bg-leaf-50"}`}
                      >
                        {tab.label}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${isActive ? "bg-white/20 text-white" : tab.key === "draft" && count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                        >
                          {tab.key === "completed" && count >= COMPLETED_REVIEWS_LIMIT
                            ? `${count}+`
                            : count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <label className="block">
                    <span className="sr-only">Buscar casos</span>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar cultura, cidade, propriedade ou sintoma"
                      className="w-full rounded-full border border-leaf-100 bg-white px-4 py-2.5 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100 xl:w-80"
                    />
                  </label>
                  <label className="block">
                    <span className="sr-only">Ordenar casos</span>
                    <select
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as SortChoice)
                      }
                      className="w-full rounded-full border border-leaf-100 bg-white px-4 py-2.5 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    >
                      {sortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={refreshQueue}
                    disabled={refreshing}
                    className="rounded-full border border-leaf-200 bg-white px-4 py-2.5 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {refreshing ? "Atualizando..." : "Atualizar"}
                  </button>
                </div>
              </div>

              {loadError && cases.length > 0 && (
                <p role="alert" className="mt-4 text-sm text-red-700">
                  {loadError}
                </p>
              )}

              <div className="mt-6 grid gap-8 lg:grid-cols-[0.9fr_1.4fr] lg:items-start">
                <div
                  id="lista-casos"
                  role="tabpanel"
                  aria-labelledby={`aba-${activeTab}`}
                  className="scroll-mt-24 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1"
                >
                  <p className="mb-3 text-sm text-slate-500">
                    {visibleCases.length === 1
                      ? "1 caso"
                      : `${visibleCases.length} casos`}
                    {search.trim() ? " encontrados" : ""}
                    {highRiskCount > 0 && activeTab !== "completed" && (
                      <span className="font-semibold text-red-700">
                        {" "}
                        · {highRiskCount} de alto risco
                      </span>
                    )}
                  </p>

                  {visibleCases.length === 0 ? (
                    <div className="rounded-3xl border border-leaf-100 bg-white p-8 text-center shadow-soft">
                      <h2 className="text-lg font-semibold text-slate-900">
                        {search.trim()
                          ? "Nenhum caso corresponde à busca"
                          : queueTabs.find((tab) => tab.key === activeTab)
                              ?.emptyTitle}
                      </h2>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                        {search.trim()
                          ? "Revise os termos ou limpe a busca para ver todos os casos desta aba."
                          : queueTabs.find((tab) => tab.key === activeTab)
                              ?.emptyText}
                      </p>
                      {search.trim() && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          className="mt-4 rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
                        >
                          Limpar busca
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {visibleCases.map((caseData) => {
                        const bucket = getCaseBucket(caseData);
                        const isSelected = selectedCase?.id === caseData.id;
                        const responsible = getResponsibleLabel(caseData);
                        const continues =
                          bucket === "draft" && canEditCase(caseData, role);

                        return (
                          <li key={caseData.id}>
                            <button
                              type="button"
                              onClick={() => selectCase(caseData.id)}
                              aria-current={isSelected ? "true" : undefined}
                              className={`w-full rounded-3xl border bg-white p-5 text-left shadow-soft transition hover:border-leaf-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-400 ${isSelected ? "border-leaf-500 ring-2 ring-leaf-100" : bucket === "draft" ? "border-amber-200" : "border-leaf-100"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">
                                    {caseData.crop}
                                  </p>
                                  <h3 className="mt-1 truncate text-base font-semibold text-slate-900">
                                    {formatLocation(caseData)}
                                  </h3>
                                  {caseData.farm?.name && (
                                    <p className="truncate text-sm text-slate-500">
                                      {caseData.farm.name}
                                    </p>
                                  )}
                                </div>
                                <RiskBadge riskLevel={caseData.risk_level} />
                              </div>
                              <div className="mt-3">
                                <CaseStatusBadge caseData={caseData} />
                              </div>
                              <dl className="mt-3 grid gap-1 text-xs text-slate-500">
                                <div>
                                  <dt className="inline">Enviado em </dt>
                                  <dd className="inline">
                                    {formatDate(caseData.created_at)}
                                  </dd>
                                </div>
                                {bucket === "draft" && (
                                  <div>
                                    <dt className="inline">Última alteração em </dt>
                                    <dd className="inline">
                                      {formatDate(caseData.updated_at)}
                                    </dd>
                                  </div>
                                )}
                                {bucket === "completed" && (
                                  <div>
                                    <dt className="inline">Finalizado em </dt>
                                    <dd className="inline">
                                      {formatDate(
                                        caseData.review?.reviewed_at ??
                                          caseData.updated_at,
                                      )}
                                    </dd>
                                  </div>
                                )}
                                {responsible && (
                                  <div>
                                    <dt className="inline">Responsável: </dt>
                                    <dd className="inline">{responsible}</dd>
                                  </div>
                                )}
                              </dl>
                              <span
                                className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${continues ? "text-amber-700" : "text-leaf-700"}`}
                              >
                                {getCaseActionLabel(caseData, role)}
                                <span aria-hidden>→</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div ref={detailRef} className="scroll-mt-24 space-y-6">
                  {!selectedCase ? (
                    <div className="hidden rounded-3xl border border-dashed border-leaf-200 bg-white/60 p-10 text-center text-sm text-slate-500 lg:block">
                      Selecione um caso na lista para ver os detalhes.
                    </div>
                  ) : (
                    <>
                      <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
                        <button
                          type="button"
                          onClick={() =>
                            document
                              .getElementById("lista-casos")
                              ?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                          className="mb-4 text-sm font-semibold text-leaf-700 lg:hidden"
                        >
                          ← Voltar à lista
                        </button>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">
                              {selectedCase.crop}
                            </p>
                            <h2 className="mt-1 text-2xl font-bold text-slate-900">
                              {formatLocation(selectedCase)}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                              Enviado em {formatDate(selectedCase.created_at)}
                              {selectedCase.farm?.name
                                ? ` · ${selectedCase.farm.name}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <RiskBadge riskLevel={selectedCase.risk_level} />
                            <CaseStatusBadge caseData={selectedCase} />
                          </div>
                        </div>
                        {editable && (
                          <a
                            href="#parecer"
                            className="mt-5 inline-flex rounded-full bg-leaf-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
                          >
                            {selectedCase.review
                              ? "Continuar edição do parecer"
                              : "Iniciar parecer"}
                          </a>
                        )}
                        {selectedBucket === "completed" && (
                          <a
                            href="#parecer"
                            className="mt-5 inline-flex rounded-full border border-leaf-200 px-5 py-2.5 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
                          >
                            Ver parecer finalizado
                          </a>
                        )}
                        {!editable && selectedBucket === "draft" && (
                          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                            Este rascunho está em edição por{" "}
                            {getResponsibleLabel(selectedCase) ?? "outra especialista"}.
                            Você pode consultar o caso, mas somente a responsável
                            ou um administrador pode alterá-lo.
                          </p>
                        )}
                      </article>

                      <DetailBlock title="Dados da propriedade">
                        <div className="grid gap-4 md:grid-cols-2">
                          <InfoItem
                            label="Propriedade"
                            value={selectedCase.farm?.name}
                          />
                          <InfoItem
                            label="Cidade/Estado"
                            value={formatLocation(selectedCase)}
                          />
                          <InfoItem
                            label="Área"
                            value={
                              selectedCase.farm?.area_hectares
                                ? `${selectedCase.farm.area_hectares} ha`
                                : null
                            }
                          />
                          <InfoItem
                            label="Tipo de solo"
                            value={selectedCase.farm?.soil_type}
                          />
                          <InfoItem label="Cultura" value={selectedCase.crop} />
                          <InfoItem
                            label="Estádio"
                            value={selectedCase.growth_stage}
                          />
                        </div>
                      </DetailBlock>

                      <DetailBlock title="Sintomas e histórico">
                        <div className="grid gap-4">
                          <div className="rounded-2xl bg-leaf-50 p-4">
                            <p className="font-semibold text-slate-900">Sintomas</p>
                            <p className="mt-2">{selectedCase.symptoms}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <p className="font-semibold text-slate-900">
                              Histórico
                            </p>
                            <p className="mt-2">
                              {displayValue(selectedCase.history)}
                            </p>
                          </div>
                        </div>
                      </DetailBlock>

                      <DetailBlock title="Imagens e análise de solo">
                        {selectedCase.images.length > 0 ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {selectedCase.images.map((image) => (
                              <a
                                key={image.id}
                                href={image.image_url}
                                target="_blank"
                                rel="noreferrer"
                                className="overflow-hidden rounded-2xl border border-leaf-100 bg-slate-50"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- URLs vêm do storage do Supabase e não têm domínio fixo para next/image. */}
                                <img
                                  src={image.image_url}
                                  alt={`Imagem do caso ${selectedCase.crop}`}
                                  className="h-44 w-full object-cover"
                                />
                                <span className="block px-4 py-3 text-xs font-medium text-slate-600">
                                  {image.image_type ?? "Imagem anexada"}
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p>Nenhuma imagem anexada.</p>
                        )}

                        <div className="mt-5 rounded-2xl border border-leaf-100 bg-white p-4">
                          <p className="font-semibold text-slate-900">
                            Análise de solo
                          </p>
                          {selectedCase.soil_analysis_url ? (
                            <a
                              href={selectedCase.soil_analysis_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex rounded-full bg-leaf-600 px-4 py-2 text-xs font-semibold text-white hover:bg-leaf-700"
                            >
                              Abrir anexo
                            </a>
                          ) : (
                            <p className="mt-2">Não enviada.</p>
                          )}
                        </div>
                      </DetailBlock>

                      <DetailBlock title="Pré-análise da IA">
                        <div className="grid gap-4">
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <p className="font-semibold text-slate-900">
                              Diagnóstico inicial
                            </p>
                            <p className="mt-2">
                              {displayValue(selectedCase.ai_summary)}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <p className="font-semibold text-slate-900">
                              Recomendação inicial
                            </p>
                            <p className="mt-2">
                              {displayValue(selectedCase.ai_recommendation)}
                            </p>
                          </div>
                        </div>
                      </DetailBlock>

                      {selectedBucket !== "completed" && (
                        <DetailBlock title="Perguntas pendentes">
                          <ul className="space-y-3">
                            {pendingQuestions.map((question) => (
                              <li key={question} className="flex gap-3">
                                <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sun-100 text-xs font-bold text-sun-700">
                                  ?
                                </span>
                                <span>{question}</span>
                              </li>
                            ))}
                          </ul>
                        </DetailBlock>
                      )}

                      {editable ? (
                        formMatchesSelection && (
                        <article
                          id="parecer"
                          className="scroll-mt-24 rounded-3xl border border-sun-200 bg-white shadow-soft"
                        >
                          <div className="p-6">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">
                                  Parecer da especialista
                                </h3>
                                <p className="mt-1 text-sm leading-6 text-slate-600">
                                  Salve como rascunho quantas vezes precisar. O
                                  produtor só vê o parecer depois de finalizado.
                                </p>
                              </div>
                              {selectedCase.review && (
                                <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                                  Rascunho
                                </Badge>
                              )}
                            </div>

                            {restoredFromBackup && (
                              <div
                                role="status"
                                className="mt-4 flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <p>
                                  Recuperamos alterações não salvas feitas neste
                                  navegador. Revise e salve o rascunho para
                                  guardá-las no sistema.
                                </p>
                                <button
                                  type="button"
                                  onClick={discardLocalChanges}
                                  className="shrink-0 font-semibold underline underline-offset-2"
                                >
                                  Descartar e usar a versão salva
                                </button>
                              </div>
                            )}

                            {reviewNotice && (
                              <p
                                role="status"
                                className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                              >
                                {reviewNotice}
                              </p>
                            )}

                            <div className="mt-5 grid gap-5">
                              {reviewFields.map((field) => {
                                const missing = missingFields.includes(field.key);

                                return (
                                  <div key={field.key}>
                                    <label
                                      htmlFor={`parecer-${field.key}`}
                                      className="text-sm font-semibold text-slate-700"
                                    >
                                      {field.label}{" "}
                                      <span className="font-normal text-slate-500">
                                        {field.requiredToFinalize
                                          ? "(obrigatório para finalizar)"
                                          : "(opcional)"}
                                      </span>
                                    </label>
                                    <textarea
                                      id={`parecer-${field.key}`}
                                      value={form[field.key]}
                                      onChange={(event) =>
                                        updateForm(field.key, event.target.value)
                                      }
                                      rows={field.rows}
                                      aria-invalid={missing || undefined}
                                      aria-describedby={
                                        missing
                                          ? `parecer-${field.key}-erro`
                                          : undefined
                                      }
                                      className={`mt-2 w-full rounded-2xl border px-4 py-3 text-sm leading-6 outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100 ${missing ? "border-red-300" : "border-leaf-100"}`}
                                      placeholder={field.placeholder}
                                    />
                                    {missing && (
                                      <p
                                        id={`parecer-${field.key}-erro`}
                                        className="mt-1 text-xs text-red-700"
                                      >
                                        Campo obrigatório para finalizar.
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {reviewError && (
                              <p
                                role="alert"
                                className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
                              >
                                {reviewError}
                              </p>
                            )}
                          </div>

                          <div className="z-10 flex flex-col gap-3 rounded-b-3xl border-t border-sun-100 bg-white/95 p-4 backdrop-blur sm:sticky sm:bottom-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                            <div>
                              <p
                                aria-live="polite"
                                className={`text-sm font-medium ${saveStatus.tone}`}
                              >
                                {saveStatus.text}
                              </p>
                              <p className="hidden text-xs text-slate-400 sm:block">
                                Atalho: Ctrl+S salva o rascunho
                              </p>
                            </div>
                            <div className="grid gap-2 sm:flex">
                              <button
                                type="button"
                                onClick={() => runReviewAction("draft")}
                                disabled={!isDirty || Boolean(submitting)}
                                className="rounded-full border border-leaf-200 bg-white px-5 py-2.5 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {submitting === "draft"
                                  ? "Salvando..."
                                  : "Salvar rascunho"}
                              </button>
                              <button
                                type="button"
                                onClick={openFinalizeDialog}
                                disabled={Boolean(submitting)}
                                className="rounded-full bg-leaf-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                Finalizar parecer…
                              </button>
                            </div>
                          </div>
                        </article>
                        )
                      ) : (
                        <article
                          id="parecer"
                          className={`scroll-mt-24 rounded-3xl border bg-white p-6 shadow-soft ${selectedBucket === "completed" ? "border-emerald-200" : "border-amber-200"}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="text-lg font-semibold text-slate-900">
                              {selectedBucket === "completed"
                                ? "Parecer finalizado"
                                : "Parecer em rascunho"}
                            </h3>
                            <p className="text-xs text-slate-500">
                              {selectedBucket === "completed"
                                ? `Finalizado em ${formatDate(selectedCase.review?.reviewed_at ?? selectedCase.updated_at)}`
                                : `Última alteração em ${formatDate(selectedCase.updated_at)}`}
                              {getResponsibleLabel(selectedCase)
                                ? ` · ${getResponsibleLabel(selectedCase)}`
                                : ""}
                            </p>
                          </div>

                          {reviewNotice && (
                            <p
                              role="status"
                              className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                            >
                              {reviewNotice}
                            </p>
                          )}

                          {selectedCase.review ? (
                            <dl className="mt-5 grid gap-5">
                              {reviewFields.map((field) => {
                                const value = reviewRowToForm(selectedCase.review)[
                                  field.key
                                ];

                                return (
                                  <div key={field.key}>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      {field.label}
                                    </dt>
                                    <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-800">
                                      {value || "Não informado"}
                                    </dd>
                                  </div>
                                );
                              })}
                            </dl>
                          ) : (
                            <p className="mt-4 text-sm text-slate-600">
                              O texto do parecer não está disponível.
                            </p>
                          )}
                        </article>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {confirmingFinalize && selectedCase && editable && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"
              role="presentation"
              onClick={() => {
                if (!submitting) setConfirmingFinalize(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="finalizar-titulo"
                aria-describedby="finalizar-descricao"
                className="w-full max-w-md rounded-3xl bg-white p-6 shadow-soft"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !submitting) {
                    setConfirmingFinalize(false);
                  }
                }}
              >
                <h2
                  id="finalizar-titulo"
                  className="text-xl font-bold text-slate-900"
                >
                  Finalizar este parecer?
                </h2>
                <p
                  id="finalizar-descricao"
                  className="mt-2 text-sm leading-6 text-slate-600"
                >
                  O parecer de{" "}
                  <strong>
                    {selectedCase.crop} · {formatLocation(selectedCase)}
                  </strong>{" "}
                  será liberado para o produtor e não poderá mais ser editado.
                  {isDirty
                    ? " As alterações ainda não salvas serão incluídas."
                    : ""}
                </p>
                <div className="mt-6 grid gap-2">
                  <button
                    type="button"
                    onClick={() => runReviewAction("finalize")}
                    disabled={Boolean(submitting)}
                    className="rounded-full bg-leaf-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting === "finalize"
                      ? "Finalizando..."
                      : "Finalizar parecer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => runReviewAction("generate_report")}
                    disabled={Boolean(submitting)}
                    className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting === "generate_report"
                      ? "Preparando relatório..."
                      : "Finalizar e gerar relatório"}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setConfirmingFinalize(false)}
                    disabled={Boolean(submitting)}
                    className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Voltar à edição
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

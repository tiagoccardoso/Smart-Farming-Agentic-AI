"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import SectionTitle from "../../components/SectionTitle";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase } from "../../lib/agronomic/case";

type SpecialistQueueResponse = {
  cases: AgronomicCase[];
  role: "specialist" | "admin";
};

type ReviewAction = "draft" | "finalize" | "generate_report";

type ReviewForm = {
  reviewText: string;
  technicalRecommendation: string;
  finalObservations: string;
};

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

const statusLabels: Record<string, string> = {
  waiting_review: "Aguardando revisão",
  in_review: "Em revisão",
  reviewed: "Revisado",
  human_reviewed: "Revisão humana concluída",
  waiting_human_review: "Aguardando especialista"
};

const knowledgeCategories: Array<{ value: KnowledgeCategory; label: string }> = [
  { value: "protocolo", label: "Protocolo" },
  { value: "artigo", label: "Artigo" },
  { value: "aula", label: "Aula" },
  { value: "recomendacao", label: "Recomendação" },
  { value: "faq", label: "FAQ" },
  { value: "caso_pratico", label: "Caso prático" },
  { value: "manejo", label: "Manejo" },
  { value: "solo", label: "Solo" },
  { value: "pragas", label: "Pragas" },
  { value: "doencas", label: "Doenças" }
];

const emptyKnowledgeForm: KnowledgeForm = {
  title: "",
  category: "protocolo",
  crop: "",
  content: "",
  file_url: "",
  active: true
};

function parseResponse(response: Response) {
  return response.json().catch(() => null).then((payload) => {
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || "A solicitação não pôde ser concluída.");
    }

    return payload;
  });
}

async function getSpecialistQueue(accessToken: string) {
  const response = await fetch("/api/specialist/human-review-cases", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseResponse(response) as Promise<SpecialistQueueResponse>;
}

async function submitHumanReview(caseId: string, form: ReviewForm, action: ReviewAction, accessToken: string) {
  const response = await fetch("/api/specialist/human-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ caseId, ...form, action })
  });

  return parseResponse(response) as Promise<{ reviewId: string; reportId?: string | null; status: string }>;
}

async function getKnowledgeMaterials(accessToken: string, filters: KnowledgeFilters) {
  const params = new URLSearchParams();

  if (filters.crop.trim()) {
    params.set("crop", filters.crop.trim());
  }

  if (filters.category) {
    params.set("category", filters.category);
  }

  const response = await fetch(`/api/specialist/knowledge${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseResponse(response) as Promise<KnowledgeResponse>;
}

async function saveKnowledgeMaterial(form: KnowledgeForm, accessToken: string, materialId?: string | null) {
  const response = await fetch("/api/specialist/knowledge", {
    method: materialId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id: materialId, ...form })
  });

  return parseResponse(response) as Promise<KnowledgeMutationResponse>;
}

async function updateKnowledgeStatus(material: KnowledgeMaterial, accessToken: string) {
  const response = await fetch("/api/specialist/knowledge", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id: material.id, active: !material.active })
  });

  return parseResponse(response) as Promise<KnowledgeMutationResponse>;
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

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatLocation(caseData: AgronomicCase) {
  return [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") || "Cidade/UF não informadas";
}

function getStatusLabel(status?: string | null) {
  if (!status) {
    return "Sem status";
  }

  return statusLabels[status] ?? status;
}

function getCategoryLabel(category?: KnowledgeCategory | null) {
  return knowledgeCategories.find((item) => item.value === category)?.label ?? "Sem categoria";
}

function buildPendingQuestions(caseData: AgronomicCase) {
  const questions = [
    "Qual porcentagem aproximada do talhão apresenta os sintomas?",
    "Os sintomas começaram em reboleiras, bordaduras ou de forma uniforme?",
    "Houve aplicação, chuva intensa, irrigação, geada ou calor extremo nos últimos 7 a 14 dias?"
  ];

  if (!caseData.history) {
    questions.push("Quais manejos, adubações e pulverizações foram feitos recentemente?");
  }

  if (caseData.images.length === 0) {
    questions.push("É possível anexar fotos próximas dos sintomas e imagens gerais da lavoura?");
  }

  if (!caseData.soil_analysis_url) {
    questions.push("Existe análise de solo recente com pH, matéria orgânica, macro e micronutrientes?");
  }

  return questions;
}

function InfoItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{displayValue(value)}</p>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <div className="mt-4 text-sm leading-6 text-slate-700">{children}</div>
    </article>
  );
}

export default function PainelDoutoraPage() {
  const [cases, setCases] = useState<AgronomicCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<ReviewAction | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewForm>({ reviewText: "", technicalRecommendation: "", finalObservations: "" });
  const [knowledgeMaterials, setKnowledgeMaterials] = useState<KnowledgeMaterial[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);
  const [knowledgeStatusId, setKnowledgeStatusId] = useState<string | null>(null);
  const [editingKnowledgeId, setEditingKnowledgeId] = useState<string | null>(null);
  const [knowledgeForm, setKnowledgeForm] = useState<KnowledgeForm>(emptyKnowledgeForm);
  const [knowledgeFilters, setKnowledgeFilters] = useState<KnowledgeFilters>({ crop: "", category: "" });

  const selectedCase = useMemo(() => cases.find((caseData) => caseData.id === selectedCaseId) ?? cases[0] ?? null, [cases, selectedCaseId]);
  const pendingQuestions = useMemo(() => (selectedCase ? buildPendingQuestions(selectedCase) : []), [selectedCase]);

  useEffect(() => {
    async function loadQueue() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);

      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      try {
        const [queueResponse, knowledgeResponse] = await Promise.all([getSpecialistQueue(accessToken), getKnowledgeMaterials(accessToken, { crop: "", category: "" })]);
        setCases(queueResponse.cases);
        setSelectedCaseId(queueResponse.cases[0]?.id ?? null);
        setKnowledgeMaterials(knowledgeResponse.materials);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Não foi possível carregar a fila da especialista.";

        if (message.toLowerCase().includes("acesso negado")) {
          setAccessDenied(true);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
        setKnowledgeLoading(false);
      }
    }

    loadQueue();
  }, []);

  function updateForm(field: keyof ReviewForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateKnowledgeForm(field: keyof KnowledgeForm, value: string | boolean) {
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
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a base de conhecimento.");
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
      active: material.active ?? true
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
      const response = await saveKnowledgeMaterial(knowledgeForm, accessToken, editingKnowledgeId);

      if (response.material) {
        setKnowledgeMaterials((current) => {
          const withoutUpdated = current.filter((material) => material.id !== response.material?.id);
          return [response.material as KnowledgeMaterial, ...withoutUpdated];
        });
      }

      setSuccessMessage(editingKnowledgeId ? "Conteúdo técnico atualizado na base de conhecimento." : "Conteúdo técnico cadastrado na base de conhecimento.");
      resetKnowledgeForm();
      await reloadKnowledge();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível salvar o conteúdo técnico.");
    } finally {
      setKnowledgeSubmitting(false);
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
        setKnowledgeMaterials((current) => current.map((item) => (item.id === response.material?.id ? (response.material as KnowledgeMaterial) : item)));
      }

      setSuccessMessage(material.active ? "Conteúdo desativado." : "Conteúdo ativado.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível alterar o status do conteúdo.");
    } finally {
      setKnowledgeStatusId(null);
    }
  }

  async function handleKnowledgeFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await reloadKnowledge(knowledgeFilters);
  }

  async function handleReviewAction(action: ReviewAction) {
    if (!selectedCase) {
      setError("Selecione um caso antes de registrar a revisão.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setAccessDenied(true);
      return;
    }

    setSubmitting(action);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await submitHumanReview(selectedCase.id, form, action, accessToken);
      const actionMessage =
        action === "draft"
          ? "Rascunho salvo e caso marcado como em revisão."
          : action === "generate_report"
            ? `Revisão finalizada e geração de relatório preparada${response.reportId ? ` (relatório ${response.reportId}).` : "."}`
            : "Revisão finalizada com sucesso.";

      setSuccessMessage(actionMessage);
      const remainingCases = cases.filter((caseData) => caseData.id !== selectedCase.id);
      setCases(remainingCases);
      setSelectedCaseId((current) => (current === selectedCase.id ? remainingCases[0]?.id ?? null : current));
      setForm({ reviewText: "", technicalRecommendation: "", finalObservations: "" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível salvar a revisão.");
    } finally {
      setSubmitting(null);
    }
  }

  const metrics = [
    { label: "Casos aguardando", value: String(cases.length), color: "text-leaf-700" },
    { label: "Alto risco", value: String(cases.filter((caseData) => caseData.risk_level === "high").length), color: "text-red-600" },
    { label: "Com análise de solo", value: String(cases.filter((caseData) => Boolean(caseData.soil_analysis_url)).length), color: "text-slate-900" }
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Área técnica da especialista
        </p>
        <SectionTitle title="Painel da Doutora" subtitle="Revise casos pagos que aguardam validação humana." />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Acompanhe a fila de casos com pagamento confirmado, confira a pré-análise da IA e registre a recomendação técnica final antes da emissão do relatório.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/painel-doutora" className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft">
          Revisões e conhecimento
        </Link>
        <Link href="/painel-doutora/usuarios" className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50">
          Usuários
        </Link>
      </div>

      {accessDenied && (
        <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft">
          <h2 className="text-lg font-semibold">Acesso negado</h2>
          <p className="mt-2 text-sm leading-6">Apenas usuários com role specialist ou admin podem acessar o Painel da Doutora.</p>
        </div>
      )}

      {!accessDenied && (
        <>
          <WorkflowStepper
            className="mt-8"
            steps={[
              { title: "Pagamento aprovado", description: "Caso entra na fila técnica.", status: "done" },
              { title: "Painel da Doutora", description: "Especialista revisa dados e IA.", status: "current" },
              { title: "Finalizar análise", description: "Parecer técnico e recomendações.", status: "next" },
              { title: "Meus Relatórios", description: "Usuário acessa o resultado final.", status: "next" }
            ]}
          />

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
                <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                <p className={`mt-3 text-4xl font-bold ${metric.color}`}>{metric.value}</p>
                <p className="mt-3 text-sm text-slate-500">Fila filtrada por human_review_requested=true e waiting_review.</p>
              </article>
            ))}
          </div>

          {error && <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-soft">{error}</div>}
          {successMessage && <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-soft">{successMessage}</div>}

          <article className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Materiais da especialista</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Base de Conhecimento</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Cadastre protocolos, artigos, aulas, FAQs e demais conteúdos técnicos para consulta interna. Embeddings e uso direto pela IA ficarão para uma próxima etapa.
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

            <form onSubmit={handleKnowledgeSubmit} className="mt-6 grid gap-5 rounded-3xl border border-leaf-100 bg-leaf-50/50 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Título</span>
                  <input
                    value={knowledgeForm.title}
                    onChange={(event) => updateKnowledgeForm("title", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="Ex.: Protocolo de manejo de ferrugem"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Categoria</span>
                  <select
                    value={knowledgeForm.category}
                    onChange={(event) => updateKnowledgeForm("category", event.target.value as KnowledgeCategory)}
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
                  <span className="text-sm font-semibold text-slate-700">Cultura</span>
                  <input
                    value={knowledgeForm.crop}
                    onChange={(event) => updateKnowledgeForm("crop", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="Ex.: soja, milho, café"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">URL do arquivo</span>
                  <input
                    value={knowledgeForm.file_url}
                    onChange={(event) => updateKnowledgeForm("file_url", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Conteúdo técnico</span>
                <textarea
                  value={knowledgeForm.content}
                  onChange={(event) => updateKnowledgeForm("content", event.target.value)}
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
                    onChange={(event) => updateKnowledgeForm("active", event.target.checked)}
                    className="h-4 w-4 rounded border-leaf-300 text-leaf-600 focus:ring-leaf-500"
                  />
                  Conteúdo ativo
                </label>
                <button
                  type="submit"
                  disabled={knowledgeSubmitting}
                  className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {knowledgeSubmitting ? "Salvando..." : editingKnowledgeId ? "Atualizar conteúdo" : "Cadastrar conteúdo"}
                </button>
              </div>
            </form>

            <form onSubmit={handleKnowledgeFilter} className="mt-6 grid gap-4 rounded-3xl border border-slate-100 bg-slate-50 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Filtrar por cultura</span>
                <input
                  value={knowledgeFilters.crop}
                  onChange={(event) => setKnowledgeFilters((current) => ({ ...current, crop: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                  placeholder="Digite uma cultura"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Filtrar por categoria</span>
                <select
                  value={knowledgeFilters.category}
                  onChange={(event) => setKnowledgeFilters((current) => ({ ...current, category: event.target.value as KnowledgeFilters["category"] }))}
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
              <button type="submit" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-800">
                Aplicar filtros
              </button>
            </form>

            <div className="mt-6 space-y-4">
              {knowledgeLoading ? (
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 text-sm text-slate-600">Carregando conteúdos técnicos...</div>
              ) : knowledgeMaterials.length === 0 ? (
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 text-sm text-slate-600">Nenhum conteúdo encontrado para os filtros selecionados.</div>
              ) : (
                knowledgeMaterials.map((material) => (
                  <div key={material.id} className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-leaf-100 px-3 py-1 text-xs font-semibold text-leaf-800">{getCategoryLabel(material.category)}</span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{material.crop || "Cultura geral"}</span>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${material.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                            {material.active ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-slate-900">{material.title || "Sem título"}</h3>
                        <p className="mt-2 text-xs text-slate-500">Criado em {formatDate(material.created_at)}</p>
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
                          {knowledgeStatusId === material.id ? "Alterando..." : material.active ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </div>
                    {material.content && <p className="mt-4 line-clamp-4 whitespace-pre-line text-sm leading-6 text-slate-700">{material.content}</p>}
                    {material.file_url && (
                      <a href={material.file_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full bg-leaf-600 px-4 py-2 text-xs font-semibold text-white hover:bg-leaf-700">
                        Abrir arquivo
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </article>

          {loading && <div className="mt-8"><LoadingCard title="Carregando fila da Doutora" description="Buscando casos pagos e pendentes de revisão humana." rows={4} /></div>}

          {!loading && cases.length === 0 && (
            <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-8 text-center shadow-soft">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf-50 text-2xl" aria-hidden>🩺</div>
              <h2 className="mt-5 text-xl font-semibold text-slate-900">Nenhum caso aguardando revisão</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Quando o usuário pagar uma revisão, o caso aparecerá aqui com status de fila e orientações para finalizar a análise.</p>
            </div>
          )}

          {cases.length > 0 && (
            <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.4fr] lg:items-start">
              <aside className="space-y-4">
                {cases.map((caseData) => {
                  const riskLevel = caseData.risk_level;
                  const selected = selectedCase?.id === caseData.id;

                  return (
                    <button
                      key={caseData.id}
                      type="button"
                      onClick={() => setSelectedCaseId(caseData.id)}
                      className={`w-full rounded-3xl border bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-leaf-300 ${selected ? "border-leaf-500 ring-2 ring-leaf-100" : "border-leaf-100"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">{caseData.crop}</p>
                          <h2 className="mt-1 text-lg font-semibold text-slate-900">{formatLocation(caseData)}</h2>
                        </div>
                        <RiskBadge riskLevel={riskLevel} />
                      </div>
                      <div className="mt-4 grid gap-2 text-sm text-slate-600">
                        <span>Envio: {formatDate(caseData.created_at)}</span>
                        <span className="inline-flex"><StatusBadge status={caseData.human_review_status} label={getStatusLabel(caseData.human_review_status)} /></span>
                      </div>
                    </button>
                  );
                })}
              </aside>

              {selectedCase && (
                <div className="space-y-6">
                  <DetailBlock title="Dados da propriedade">
                    <div className="grid gap-4 md:grid-cols-2">
                      <InfoItem label="Propriedade" value={selectedCase.farm?.name} />
                      <InfoItem label="Cidade/Estado" value={formatLocation(selectedCase)} />
                      <InfoItem label="Área" value={selectedCase.farm?.area_hectares ? `${selectedCase.farm.area_hectares} ha` : null} />
                      <InfoItem label="Tipo de solo" value={selectedCase.farm?.soil_type} />
                      <InfoItem label="Cultura" value={selectedCase.crop} />
                      <InfoItem label="Estádio" value={selectedCase.growth_stage} />
                    </div>
                  </DetailBlock>

                  <DetailBlock title="Sintomas e histórico">
                    <div className="grid gap-4">
                      <div className="rounded-2xl bg-leaf-50 p-4">
                        <p className="font-semibold text-slate-900">Sintomas</p>
                        <p className="mt-2">{selectedCase.symptoms}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="font-semibold text-slate-900">Histórico</p>
                        <p className="mt-2">{displayValue(selectedCase.history)}</p>
                      </div>
                    </div>
                  </DetailBlock>

                  <DetailBlock title="Imagens e análise de solo">
                    {selectedCase.images.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {selectedCase.images.map((image) => (
                          <a key={image.id} href={image.image_url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-leaf-100 bg-slate-50">
                            {/* eslint-disable-next-line @next/next/no-img-element -- URLs vêm do storage do Supabase e não têm domínio fixo para next/image. */}
                            <img src={image.image_url} alt={`Imagem do caso ${selectedCase.crop}`} className="h-44 w-full object-cover" />
                            <span className="block px-4 py-3 text-xs font-medium text-slate-600">{image.image_type ?? "Imagem anexada"}</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p>Nenhuma imagem anexada.</p>
                    )}

                    <div className="mt-5 rounded-2xl border border-leaf-100 bg-white p-4">
                      <p className="font-semibold text-slate-900">Análise de solo</p>
                      {selectedCase.soil_analysis_url ? (
                        <a href={selectedCase.soil_analysis_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-full bg-leaf-600 px-4 py-2 text-xs font-semibold text-white hover:bg-leaf-700">
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
                        <p className="font-semibold text-slate-900">Diagnóstico inicial</p>
                        <p className="mt-2">{displayValue(selectedCase.ai_summary)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="font-semibold text-slate-900">Recomendação inicial</p>
                        <p className="mt-2">{displayValue(selectedCase.ai_recommendation)}</p>
                      </div>
                    </div>
                  </DetailBlock>

                  <DetailBlock title="Perguntas pendentes">
                    <ul className="space-y-3">
                      {pendingQuestions.map((question) => (
                        <li key={question} className="flex gap-3">
                          <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sun-100 text-xs font-bold text-sun-700">?</span>
                          <span>{question}</span>
                        </li>
                      ))}
                    </ul>
                  </DetailBlock>

                  <article className="rounded-3xl border border-sun-200 bg-white p-6 shadow-soft">
                    <h3 className="text-lg font-semibold text-slate-900">Formulário da especialista</h3>
                    <div className="mt-5 grid gap-5">
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Revisão técnica</span>
                        <textarea
                          value={form.reviewText}
                          onChange={(event) => updateForm("reviewText", event.target.value)}
                          rows={5}
                          className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                          placeholder="Registre a interpretação técnica do caso, hipóteses prováveis e pontos de atenção."
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Recomendação técnica</span>
                        <textarea
                          value={form.technicalRecommendation}
                          onChange={(event) => updateForm("technicalRecommendation", event.target.value)}
                          rows={5}
                          className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                          placeholder="Descreva próximos passos, monitoramento, coletas e cuidados de manejo."
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Observações finais</span>
                        <textarea
                          value={form.finalObservations}
                          onChange={(event) => updateForm("finalObservations", event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                          placeholder="Inclua ressalvas, limites da análise remota e pendências para o produtor."
                        />
                      </label>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleReviewAction("draft")}
                        disabled={Boolean(submitting)}
                        className="rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting === "draft" ? "Salvando rascunho..." : "Salvar rascunho"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewAction("finalize")}
                        disabled={Boolean(submitting)}
                        className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {submitting === "finalize" ? "Finalizando análise..." : "Finalizar análise"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewAction("generate_report")}
                        disabled={Boolean(submitting)}
                        className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {submitting === "generate_report" ? "Preparando relatório..." : "Finalizar e gerar relatório"}
                      </button>
                    </div>
                  </article>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import SectionTitle from "../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase, AgronomicRiskLevel } from "../../lib/agronomic/case";

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

const riskLabels: Record<AgronomicRiskLevel, string> = {
  low: "baixo",
  medium: "médio",
  high: "alto"
};

const riskStyles: Record<AgronomicRiskLevel, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800"
};

const statusLabels: Record<string, string> = {
  waiting_review: "Aguardando revisão",
  in_review: "Em revisão",
  reviewed: "Revisado",
  human_reviewed: "Revisão humana concluída",
  waiting_human_review: "Aguardando especialista"
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
        const response = await getSpecialistQueue(accessToken);
        setCases(response.cases);
        setSelectedCaseId(response.cases[0]?.id ?? null);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Não foi possível carregar a fila da especialista.";

        if (message.toLowerCase().includes("acesso negado")) {
          setAccessDenied(true);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    }

    loadQueue();
  }, []);

  function updateForm(field: keyof ReviewForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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

      {accessDenied && (
        <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft">
          <h2 className="text-lg font-semibold">Acesso negado</h2>
          <p className="mt-2 text-sm leading-6">Apenas usuários com role specialist ou admin podem acessar o Painel da Doutora.</p>
        </div>
      )}

      {!accessDenied && (
        <>
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
          {loading && <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 text-sm text-slate-600 shadow-soft">Carregando casos aguardando revisão...</div>}

          {!loading && cases.length === 0 && (
            <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-8 text-center shadow-soft">
              <h2 className="text-xl font-semibold text-slate-900">Nenhum caso aguardando revisão</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Quando um pagamento for confirmado, o caso aparecerá aqui com status waiting_review.</p>
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
                        {riskLevel && <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskStyles[riskLevel]}`}>Risco {riskLabels[riskLevel]}</span>}
                      </div>
                      <div className="mt-4 grid gap-2 text-sm text-slate-600">
                        <span>Envio: {formatDate(caseData.created_at)}</span>
                        <span>Status: {getStatusLabel(caseData.human_review_status)}</span>
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
                        {submitting === "draft" ? "Salvando..." : "Salvar rascunho"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewAction("finalize")}
                        disabled={Boolean(submitting)}
                        className="rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {submitting === "finalize" ? "Finalizando..." : "Finalizar revisão"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewAction("generate_report")}
                        disabled={Boolean(submitting)}
                        className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {submitting === "generate_report" ? "Preparando..." : "Gerar relatório final"}
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

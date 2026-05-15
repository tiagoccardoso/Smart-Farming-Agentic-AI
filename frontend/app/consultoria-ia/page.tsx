"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SectionTitle from "../../components/SectionTitle";
import { analyzeAgronomicCase, getAgronomicCase } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase, AgronomicPreAnalysis, AgronomicRiskLevel } from "../../lib/agronomic/case";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const riskStyles: Record<AgronomicRiskLevel, string> = {
  baixo: "border-emerald-200 bg-emerald-50 text-emerald-800",
  médio: "border-amber-200 bg-amber-50 text-amber-800",
  alto: "border-red-200 bg-red-50 text-red-800"
};

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") {
    return "Não informado";
  }

  return String(value);
}

function InfoItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{displayValue(value)}</p>
    </div>
  );
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-leaf-50 p-5">
      <h4 className="font-semibold text-slate-900">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsultoriaIAContent() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") ?? "";
  const [caseData, setCaseData] = useState<AgronomicCase | null>(null);
  const [analysis, setAnalysis] = useState<AgronomicPreAnalysis | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingCase, setLoadingCase] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewUrl = useMemo(() => `/revisao-humana?caseId=${encodeURIComponent(caseId)}`, [caseId]);
  const requiresHumanReview = analysis?.riskLevel === "médio" || analysis?.riskLevel === "alto";

  useEffect(() => {
    async function loadCase() {
      setError(null);
      setCaseData(null);
      setAnalysis(null);
      setChatMessages([]);

      if (!caseId) {
        return;
      }

      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setError("Faça login para carregar os dados do caso enviado.");
        return;
      }

      setLoadingCase(true);

      try {
        const response = (await getAgronomicCase(caseId, accessToken)) as { case: AgronomicCase };
        setCaseData(response.case);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o caso.");
      } finally {
        setLoadingCase(false);
      }
    }

    loadCase();
  }, [caseId]);

  async function handleGenerateAnalysis() {
    if (!caseId) {
      setError("Abra a consultoria usando um caseId válido na URL.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setError("Faça login para gerar a pré-análise com IA.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = (await analyzeAgronomicCase(caseId, accessToken)) as { analysis: AgronomicPreAnalysis };
      setAnalysis(response.analysis);
      setChatMessages([
        {
          role: "assistant",
          content: "Pré-análise gerada. Você pode me perguntar sobre hipóteses, dados faltantes ou próximos passos, lembrando que a orientação é inicial."
        }
      ]);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Não foi possível gerar a pré-análise.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion || !caseId) {
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setError("Faça login para conversar com a IA sobre este caso.");
      return;
    }

    setQuestion("");
    setChatLoading(true);
    setError(null);
    setChatMessages((current) => [...current, { role: "user", content: trimmedQuestion }]);

    try {
      const response = (await analyzeAgronomicCase(caseId, accessToken, trimmedQuestion)) as { analysis: AgronomicPreAnalysis };
      setAnalysis(response.analysis);
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.analysis.conversationalAnswer ?? "Não consegui responder com os dados atuais. Reúna mais informações e solicite revisão técnica se houver risco."
        }
      ]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Não foi possível enviar a pergunta.");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="bg-hero-gradient">
      <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-soft md:p-8">
            <p className="mb-4 inline-flex rounded-full bg-leaf-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
              Consultoria agronômica com IA
            </p>
            <SectionTitle title="Consultoria IA" subtitle="Veja o caso enviado, gere uma pré-análise e converse com a IA." />
            <p className="text-sm leading-6 text-slate-600">
              A IA organiza os dados do caso para uma triagem inicial. Ela sempre deve ser usada como apoio preliminar, não como substituta de diagnóstico ou revisão profissional.
            </p>

            {!caseId && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Nenhum caseId foi informado na URL. Envie um caso completo para iniciar a consultoria com dados do Supabase.
              </div>
            )}

            {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerateAnalysis}
                disabled={!caseData || generating}
                className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {generating ? "Gerando pré-análise..." : "Gerar pré-análise com IA"}
              </button>
              <Link href="/enviar-caso" className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft hover:border-leaf-300">
                Enviar outro caso
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <h3 className="text-xl font-semibold text-slate-900">Resumo do caso</h3>
            {loadingCase ? (
              <p className="mt-4 text-sm text-slate-600">Carregando dados do caso no Supabase...</p>
            ) : caseData ? (
              <div className="mt-6 space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoItem label="Cultura" value={caseData.crop} />
                  <InfoItem label="Propriedade" value={caseData.farm?.name} />
                  <InfoItem label="Cidade/Estado" value={[caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/")} />
                  <InfoItem label="Estágio da cultura" value={caseData.growth_stage} />
                </div>

                <div className="rounded-2xl bg-leaf-50 p-5">
                  <h4 className="font-semibold text-slate-900">Sintomas</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{caseData.symptoms}</p>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">Histórico</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{displayValue(caseData.history)}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-900">Imagens anexadas</h4>
                  {caseData.images.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {caseData.images.map((image) => (
                        <a key={image.id} href={image.image_url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-leaf-100 bg-slate-50 shadow-soft">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.image_url} alt="Imagem anexada ao caso" className="h-44 w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">Nenhuma imagem anexada.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">Análise de solo</h4>
                  {caseData.soil_analysis_url ? (
                    <a href={caseData.soil_analysis_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-leaf-700 hover:text-leaf-800">
                      Abrir análise de solo anexada
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">Nenhuma análise de solo anexada.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Informe um caseId válido para visualizar o resumo do caso.</p>
            )}
          </div>
        </div>

        {analysis && (
          <div className="mt-10 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Resultado da IA</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900">Pré-análise agronômica inicial</h3>
              </div>
              <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${riskStyles[analysis.riskLevel]}`}>Risco {analysis.riskLevel}</span>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                <h4 className="font-semibold text-slate-900">Diagnóstico inicial</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">{analysis.initialDiagnosis}</p>
              </div>
              <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                <h4 className="font-semibold text-slate-900">Recomendação inicial</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">{analysis.initialRecommendation}</p>
              </div>
              <AnalysisList title="Hipóteses prováveis" items={analysis.probableHypotheses} />
              <AnalysisList title="Perguntas pendentes" items={analysis.pendingQuestions} />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
                <p className="font-semibold">Aviso de orientação não substitutiva</p>
                <p className="mt-2">{analysis.nonSubstitutiveNotice}</p>
                <p className="mt-2">{analysis.humanReviewSuggestion}</p>
              </div>
              {requiresHumanReview && (
                <Link href={reviewUrl} className="inline-flex justify-center rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
                  Solicitar revisão da especialista
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="mt-10 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
          <h3 className="text-xl font-semibold text-slate-900">Converse com a IA sobre este caso</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use o chat para aprofundar dúvidas sobre hipóteses, dados faltantes e próximos passos. A resposta continuará sendo uma orientação inicial.
          </p>

          <div className="mt-5 space-y-3">
            {chatMessages.length === 0 ? (
              <div className="rounded-2xl bg-leaf-50 p-4 text-sm text-slate-600">Gere a pré-análise para iniciar a conversa contextualizada.</div>
            ) : (
              chatMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-2xl p-4 text-sm leading-6 ${message.role === "user" ? "ml-auto max-w-2xl bg-leaf-600 text-white" : "max-w-3xl bg-leaf-50 text-slate-700"}`}>
                  {message.content}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAskQuestion} className="mt-5 flex flex-col gap-3 md:flex-row">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ex.: Quais informações faltam antes de decidir uma aplicação?"
              disabled={!analysis || chatLoading}
              className="min-h-12 flex-1 rounded-full border border-leaf-100 bg-white px-5 text-sm text-slate-900 shadow-soft focus:border-leaf-400 focus:outline-none disabled:bg-slate-100"
            />
            <button
              type="submit"
              disabled={!analysis || chatLoading || !question.trim()}
              className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {chatLoading ? "Enviando..." : "Perguntar"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}


export default function ConsultoriaIAPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">Carregando consultoria...</div>}>
      <ConsultoriaIAContent />
    </Suspense>
  );
}

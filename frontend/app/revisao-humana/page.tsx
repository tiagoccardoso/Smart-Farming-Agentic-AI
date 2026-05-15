"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SectionTitle from "../../components/SectionTitle";
import { getAgronomicCase, requestHumanReviewCheckout } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase, AgronomicRiskLevel } from "../../lib/agronomic/case";

const benefits = [
  "Análise personalizada",
  "Revisão das fotos e sintomas",
  "Complementação da resposta da IA",
  "Relatório final revisado"
];

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

function getHumanReviewPriceCents() {
  const configuredPrice = Number(process.env.NEXT_PUBLIC_HUMAN_REVIEW_PRICE_CENTS);
  return Number.isFinite(configuredPrice) && configuredPrice > 0 ? Math.round(configuredPrice) : 19700;
}

function formatCurrency(priceCents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(priceCents / 100);
}

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

function RevisaoHumanaContent() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") ?? "";
  const checkoutStatus = searchParams.get("payment");
  const [caseData, setCaseData] = useState<AgronomicCase | null>(null);
  const [loadingCase, setLoadingCase] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const priceCents = useMemo(() => getHumanReviewPriceCents(), []);
  const formattedPrice = useMemo(() => formatCurrency(priceCents), [priceCents]);
  const riskLevel = caseData?.risk_level ?? null;
  const alreadyRequested = caseData?.human_review_requested;

  useEffect(() => {
    if (checkoutStatus === "success") {
      setSuccessMessage("Checkout iniciado/concluído com sucesso. A revisão ficará pendente até a confirmação do pagamento.");
    }

    if (checkoutStatus === "cancelled") {
      setSuccessMessage("Checkout cancelado. Você pode solicitar a revisão novamente quando desejar.");
    }
  }, [checkoutStatus]);

  useEffect(() => {
    async function loadCase() {
      setError(null);
      setCaseData(null);

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

  async function handleRequestReview() {
    if (!caseId) {
      setError("Abra esta página usando um caseId válido na URL.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setError("Faça login para solicitar a revisão humana.");
      return;
    }

    setRequesting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = (await requestHumanReviewCheckout(caseId, accessToken)) as {
        checkoutUrl: string;
      };

      window.location.href = response.checkoutUrl;
      return;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível solicitar a revisão humana.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Validação especializada
        </p>
        <SectionTitle title="Revisão Humana" subtitle="Solicite revisão humana de um caso já analisado pela IA." />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Informe um caso pela URL, revise o resumo da pré-análise e solicite a avaliação de uma Doutora em Agronomia antes de decisões de manejo sensíveis.
        </p>
      </div>

      {!caseId && (
        <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-soft">
          <h3 className="font-semibold">caseId não informado</h3>
          <p className="mt-2 text-sm leading-6">Abra esta página no formato /revisao-humana?caseId=ID_DO_CASO ou acesse pela pré-análise da consultoria IA.</p>
          <Link href="/enviar-caso" className="mt-4 inline-flex rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
            Enviar ou localizar caso
          </Link>
        </div>
      )}

      {error && <div className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-soft">{error}</div>}
      {successMessage && <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 shadow-soft">{successMessage}</div>}
      {loadingCase && <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 text-sm text-slate-600 shadow-soft">Carregando dados do caso...</div>}

      {caseData && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="space-y-6">
            <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Caso agronômico</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">{caseData.crop}</h3>
                </div>
                <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{caseData.status ?? "sem status"}</span>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoItem label="Estádio" value={caseData.growth_stage} />
                <InfoItem label="Fazenda" value={caseData.farm?.name} />
                <InfoItem label="Localização" value={[caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/")} />
                <InfoItem label="Fotos anexadas" value={caseData.images.length} />
              </div>

              <div className="mt-6 rounded-2xl bg-leaf-50 p-5">
                <h4 className="font-semibold text-slate-900">Sintomas informados</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">{caseData.symptoms}</p>
              </div>
            </article>

            <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Resumo da IA</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">Pré-análise registrada</h3>
                </div>
                {riskLevel && <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${riskStyles[riskLevel]}`}>Risco {riskLabels[riskLevel]}</span>}
              </div>

              {caseData.ai_summary || caseData.ai_recommendation ? (
                <div className="mt-6 grid gap-5">
                  <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                    <h4 className="font-semibold text-slate-900">Diagnóstico inicial</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{caseData.ai_summary ?? "Não registrado."}</p>
                  </div>
                  <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                    <h4 className="font-semibold text-slate-900">Recomendação inicial</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{caseData.ai_recommendation ?? "Não registrada."}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
                  Ainda não há pré-análise salva para este caso. Gere a análise na consultoria IA antes de solicitar a revisão humana.
                  <div>
                    <Link href={`/consultoria-ia?caseId=${encodeURIComponent(caseId)}`} className="mt-4 inline-flex rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
                      Gerar pré-análise com IA
                    </Link>
                  </div>
                </div>
              )}
            </article>
          </div>

          <aside className="rounded-3xl border border-sun-200 bg-white p-6 shadow-soft md:p-8">
            <p className="inline-flex rounded-full bg-sun-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sun-700">Oferta de revisão</p>
            <h3 className="mt-4 text-2xl font-bold text-slate-900">Revisão humana por Doutora em Agronomia</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Ideal para complementar a triagem inicial da IA com avaliação técnica personalizada sobre fotos, sintomas, histórico e próximos passos.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex items-center gap-3">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xs font-semibold text-leaf-700">✓</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-2xl bg-slate-50 p-5">
              <p className="text-sm font-medium text-slate-600">Preço para revisão de caso simples</p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{formattedPrice}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">Valor inicial do serviço human_case_review criado diretamente no checkout Stripe em BRL.</p>
            </div>

            {alreadyRequested && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Este caso já foi marcado para revisão humana. Status atual: {caseData.human_review_status ?? "não informado"}.
              </div>
            )}

            <button
              type="button"
              onClick={handleRequestReview}
              disabled={requesting || !caseData.ai_summary}
              className="mt-6 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {requesting ? "Criando ordem..." : "Solicitar revisão humana"}
            </button>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Ao clicar, o sistema cria uma ordem em one_time_orders com pagamento pendente e redireciona para o checkout Stripe.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}

export default function RevisaoHumanaPage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">Carregando revisão humana...</section>}>
      <RevisaoHumanaContent />
    </Suspense>
  );
}

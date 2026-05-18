"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import { getAgronomicCase, requestHumanReviewCheckout } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type { AgronomicCase } from "../../lib/agronomic/case";

const benefits = [
  "Análise por Doutora em Agronomia",
  "Revisão técnica personalizada",
  "Parecer profissional",
  "Relatório técnico",
  "Análise aprofundada"
];

const statusLabels: Record<string, string> = {
  waiting_payment_human_review: "Aguardando pagamento da revisão humana",
  waiting_human_review: "Aguardando revisão humana pela especialista",
  ai_analyzed: "Pré-análise da IA concluída",
  submitted: "Caso enviado",
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") ?? "";
  const checkoutStatus = searchParams.get("payment");
  const [caseData, setCaseData] = useState<AgronomicCase | null>(null);
  const [loadingCase, setLoadingCase] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const priceCents = useMemo(() => getHumanReviewPriceCents(), []);
  const formattedPrice = useMemo(() => formatCurrency(priceCents), [priceCents]);
  const riskLevel = caseData?.risk_level ?? null;
  const alreadyRequested = caseData?.human_review_requested;
  const canDelete = deleteConfirmation.trim().toUpperCase() === "EXCLUIR";
  const answeredQuestions = caseData?.pending_questions?.filter((question) => question.status === "answered") ?? [];
  const pendingQuestions = caseData?.pending_questions?.filter((question) => question.status !== "answered") ?? [];

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

  async function handleCancelReview() {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !caseId) return;
    setCancelling(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}/human-review`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível cancelar a solicitação.");
      setCaseData((current) => (current ? { ...current, ...payload.case } : current));
      setSuccessMessage("Solicitação de revisão humana cancelada. O caso voltou para a consultoria IA.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Não foi possível cancelar a solicitação.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDeleteCase() {
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken || !caseId || !canDelete) return;
    setDeleting(true);
    setError(null);
    setSuccessMessage("Excluindo caso...");
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Erro ao excluir caso.");
      setSuccessMessage("Caso excluído com sucesso.");
      router.replace("/consultoria-ia");
    } catch (deleteError) {
      setSuccessMessage(null);
      setError(deleteError instanceof Error ? deleteError.message : "Erro ao excluir caso.");
    } finally {
      setDeleting(false);
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
        <SafetyDisclaimer className="mt-5 max-w-3xl bg-white/90" />
      </div>

      <WorkflowStepper
        className="mt-8"
        steps={[
          { title: "Enviar caso", description: "Caso salvo com sintomas e anexos.", href: "/enviar-caso", status: caseData ? "done" : "next" },
          { title: "Pré-análise IA", description: "Risco identificado antes do pagamento.", href: caseId ? `/consultoria-ia?caseId=${encodeURIComponent(caseId)}` : "/consultoria-ia", status: caseData?.ai_summary ? "done" : "next" },
          { title: "Pagar revisão", description: "Confirme a revisão humana especializada.", status: alreadyRequested ? "done" : "current" },
          { title: "Painel da Doutora", description: "Especialista finaliza o parecer.", status: alreadyRequested ? "current" : "next" },
          { title: "Meus relatórios", description: "Relatório final aparece para o usuário.", href: "/meus-relatorios", status: "next" }
        ]}
      />

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
      {loadingCase && <div className="mt-8"><LoadingCard title="Carregando caso para revisão" description="Buscando status, risco e pré-análise antes de liberar o pagamento." rows={4} /></div>}

      {caseData && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="space-y-6">
            <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Caso agronômico</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">{caseData.crop}</h3>
                </div>
                <StatusBadge status={caseData.status} label={statusLabels[caseData.status ?? ""] ?? caseData.status ?? "Sem status"} />
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

              {caseData.images.length > 0 && (
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {caseData.images.map((image) => (
                    <div key={image.id} className="relative h-44 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                      <Image src={image.image_url} alt="Imagem anexada ao caso" fill sizes="(max-width: 768px) 100vw, 320px" className="object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Resumo da IA</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">Pré-análise registrada</h3>
                </div>
                <RiskBadge riskLevel={riskLevel} />
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

            <article className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Perguntas respondidas</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">Contexto adicional para a especialista</h3>
              <div className="mt-5 space-y-3">
                {answeredQuestions.length === 0 && pendingQuestions.length === 0 && <p className="text-sm text-slate-500">Nenhuma pergunta complementar registrada para este caso.</p>}
                {answeredQuestions.map((question) => (
                  <div key={question.id} className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm">
                    <p className="font-semibold text-slate-900">{question.question}</p>
                    <p className="mt-2 text-slate-700">{question.answer}</p>
                  </div>
                ))}
                {pendingQuestions.map((question) => (
                  <div key={question.id} className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Pendente: {question.question}</p>
                  </div>
                ))}
              </div>
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
                <strong>Status atual:</strong> {caseData.human_review_status === "pending_payment" ? "Aguardando pagamento da revisão humana" : caseData.human_review_status ?? "não informado"}.
              </div>
            )}

            <button
              type="button"
              onClick={handleRequestReview}
              disabled={requesting || !caseData.ai_summary}
              className="mt-6 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {requesting ? "Abrindo pagamento..." : "Pagar e enviar para especialista"}
            </button>

            <button
              type="button"
              onClick={handleCancelReview}
              disabled={cancelling || deleting || caseData.human_review_status === "waiting_review"}
              className="mt-3 w-full rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? "Cancelando..." : "Cancelar solicitação"}
            </button>

            <button
              type="button"
              onClick={() => { setDeleteConfirmation(""); setShowDelete(true); }}
              disabled={deleting}
              className="mt-3 w-full rounded-full border border-red-200 bg-red-50 px-6 py-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Excluir caso
            </button>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Ao clicar, o sistema cria uma ordem em one_time_orders com pagamento pendente e redireciona para o checkout Stripe.
            </p>
          </aside>
        </div>
      )}
      {showDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-soft">
            <h2 className="text-2xl font-black text-slate-950">Excluir caso permanentemente</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">Esta ação não poderá ser desfeita. O caso, imagens, conversa, perguntas, pedidos de revisão, relatórios e arquivos serão removidos.</p>
            <label className="mt-5 block text-sm font-bold text-slate-700">
              Digite EXCLUIR para confirmar
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} disabled={deleting} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-red-300" placeholder="EXCLUIR" />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowDelete(false)} disabled={deleting} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-black disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={handleDeleteCase} disabled={!canDelete || deleting} className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">{deleting ? "Excluindo..." : "Excluir caso"}</button>
            </div>
          </div>
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

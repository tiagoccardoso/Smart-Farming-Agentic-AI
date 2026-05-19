"use client";

import { useMemo, useState } from "react";
import SectionTitle from "../../components/SectionTitle";

type Plan = {
  name: string;
  slug: string;
  eyebrow: string;
  price: string;
  audience: string;
  description: string;
  features: string[];
  exclusions?: string[];
  buttonLabel: string;
  highlighted?: boolean;
  badge?: string;
};

type ConsultingService = {
  name: string;
  serviceType: string;
  price: string;
  description: string;
};

type CheckoutTarget = {
  type: "subscription" | "consulting";
  slug: string;
  label: string;
};

const legalNotice = "As análises geradas por IA são orientativas e não substituem consultoria profissional habilitada.";
const freePlanNotice = "As respostas geradas por IA são orientativas e não substituem avaliação profissional.";

const valuePhrases = ["Decisões agrícolas mais seguras", "IA + suporte especializado", "Análises organizadas e históricas"];

const plans: Plan[] = [
  {
    name: "Plano Gratuito",
    slug: "gratuito",
    eyebrow: "Demonstração",
    price: "R$ 0",
    audience: "Para conhecer a plataforma e validar valor rapidamente.",
    description: "Uma entrada objetiva para testar a IA orientativa em dúvidas agrícolas pontuais.",
    features: ["3 perguntas agrícolas por mês", "1 triagem simples com imagem", "Recomendação agrícola básica", "Sem PDF", "Histórico das perguntas realizadas", "Sem análise de solo", "Sem revisão humana"],
    buttonLabel: "Começar grátis"
  },
  {
    name: "IA Básica",
    slug: "ia-basica",
    eyebrow: "Orientação inicial",
    price: "R$ 39/mês",
    audience: "Pequenos produtores, estudantes e técnicos agrícolas.",
    description: "Apoio recorrente para organizar dúvidas, recomendações iniciais e triagens simples.",
    features: ["Perguntas agrícolas com IA", "Histórico simples", "Recomendações iniciais", "Triagem básica de sintomas", "Limite mensal controlado", "Orientação inicial com IA"],
    exclusions: ["Sem revisão humana", "Sem análise avançada de solo", "Sem relatórios técnicos completos"],
    buttonLabel: "Assinar IA Básica"
  },
  {
    name: "IA Profissional",
    slug: "ia-profissional",
    eyebrow: "Plano recomendado",
    price: "R$ 97/mês",
    audience: "Produtores e consultores que utilizarão o sistema com frequência.",
    description: "Sistema completo de decisão agronômica assistida por IA, com relatórios e histórico por propriedade.",
    features: ["Limite alto de análises", "Upload de fotos", "Upload de análise de solo", "Relatórios PDF", "Histórico por propriedade", "Análises mais completas", "Recomendações organizadas", "Prioridade de processamento", "Suporte prioritário"],
    buttonLabel: "Assinar IA Profissional",
    highlighted: true,
    badge: "Mais escolhido"
  },
  {
    name: "IA + Revisão Humana",
    slug: "ia-revisao-humana",
    eyebrow: "Premium",
    price: "R$ 397/mês",
    audience: "Operações que precisam de validação especializada mensal e acompanhamento mais próximo.",
    description: "Combina a velocidade da IA com uma revisão humana mensal feita por especialista.",
    features: ["Tudo do IA Profissional", "1 revisão humana mensal incluída", "Análise revisada por especialista", "Relatório revisado", "Suporte prioritário", "Acompanhamento mais próximo", "Revisões extras podem ser contratadas separadamente"],
    buttonLabel: "Assinar Premium"
  }
];

const consultingServices: ConsultingService[] = [
  {
    name: "Revisão humana de caso",
    serviceType: "human_case_review",
    price: "R$ 197",
    description: "Validação especializada de um caso pontual já estruturado pela plataforma."
  },
  {
    name: "Interpretação de análise de solo",
    serviceType: "soil_analysis_review",
    price: "R$ 250",
    description: "Leitura técnica dos indicadores de solo com recomendações organizadas."
  },
  {
    name: "Relatório técnico especializado",
    serviceType: "technical_report",
    price: "A partir de R$ 497",
    description: "Documento técnico revisado para decisões agronômicas mais sensíveis."
  },
  {
    name: "Acompanhamento mensal de propriedade",
    serviceType: "monthly_farm_followup",
    price: "A partir de R$ 997/mês",
    description: "Rotina de acompanhamento para histórico, prioridades e suporte especializado."
  }
];

function CheckIcon() {
  return <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xs font-bold text-leaf-700">✓</span>;
}

function formatPlanPayload(slug: string) {
  return {
    planSlug: slug,
    successUrl: "/planos?checkout=success",
    cancelUrl: "/planos?checkout=cancelled"
  };
}

export default function PlanosPage() {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const planCountLabel = useMemo(() => `${plans.length} planos disponíveis`, []);

  async function handleCheckout(target: CheckoutTarget) {
    setLoadingKey(`${target.type}:${target.slug}`);
    setFeedback(null);

    const endpoint = target.type === "subscription" ? "/api/stripe/create-subscription-checkout" : "/api/stripe/create-human-review-checkout";
    const payload =
      target.type === "subscription"
        ? formatPlanPayload(target.slug)
        : {
            serviceType: target.slug,
            source: "planos",
            successUrl: "/planos?consultoria=success",
            cancelUrl: "/planos?consultoria=cancelled"
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);

      if (data?.checkoutUrl) {
        setFeedback({ type: "success", message: `Checkout preparado para ${target.label}. Redirecionando para pagamento seguro...` });
        window.location.href = data.checkoutUrl;
        return;
      }

      if (response.ok) {
        setFeedback({ type: "success", message: `Solicitação de ${target.label} registrada. O checkout será concluído quando a integração Stripe estiver habilitada.` });
        return;
      }

      setFeedback({
        type: response.status === 404 ? "info" : "error",
        message:
          data?.error ||
          (target.type === "subscription"
            ? "Fluxo de assinatura preparado para integração futura com Stripe."
            : "Para solicitar consultoria avulsa, envie um caso e conclua o checkout na próxima etapa.")
      });
    } catch (error) {
      setFeedback({
        type: "info",
        message: error instanceof Error ? error.message : "Fluxo preparado. Tente novamente quando a integração de checkout estiver ativa."
      });
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <main className="bg-gradient-to-b from-leaf-50 via-white to-soil-50/60">
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-6 md:py-20 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-hero-gradient shadow-soft">
          <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-leaf-700 shadow-sm">
                Plataforma profissional de apoio à decisão agronômica
              </p>
              <SectionTitle title="Planos" subtitle="Decisão agronômica assistida por IA, com revisão humana opcional." />
              <p className="max-w-3xl text-base leading-7 text-slate-700">
                Estruture informações da propriedade, imagens, análises e recomendações em um fluxo técnico organizado. A IA orientativa acelera a triagem e os especialistas podem revisar casos quando a decisão exigir validação profissional.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {valuePhrases.map((phrase) => (
                  <span key={phrase} className="rounded-full border border-leaf-200 bg-white/85 px-4 py-2 text-sm font-semibold text-leaf-800 shadow-sm">
                    {phrase}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-soft">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Estratégia híbrida</p>
              <h2 className="mt-3 text-2xl font-bold text-slate-900">IA orientativa + análise técnica organizada</h2>
              <div className="mt-5 grid gap-3 text-sm text-slate-700">
                {["Relatórios e histórico da propriedade", "Upload de fotos e análise de solo", "Suporte especializado e revisão humana opcional"].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl bg-leaf-50 p-3">
                    <CheckIcon />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{legalNotice}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-leaf-700">Comparativo de planos</p>
            <p className="text-sm text-slate-600">{planCountLabel}. Escolha conforme volume de análises, relatórios e necessidade de validação humana.</p>
          </div>
          {feedback ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                feedback.type === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                  : feedback.type === "error"
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-amber-200 bg-amber-50 text-amber-900"
              }`}
              role="status"
            >
              {feedback.message}
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Nenhuma solicitação iniciada.</p>
          )}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-4 lg:items-stretch">
          {plans.map((plan) => {
            const buttonKey = `subscription:${plan.slug}`;
            const isLoading = loadingKey === buttonKey;

            return (
              <article
                key={plan.slug}
                className={`relative flex flex-col rounded-[2rem] border bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl ${
                  plan.highlighted ? "border-leaf-500 ring-4 ring-leaf-100 lg:scale-[1.04] lg:p-7" : "border-leaf-100"
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-4 left-6 rounded-full bg-leaf-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-soft">
                    {plan.badge}
                  </span>
                )}
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">{plan.eyebrow}</p>
                <h3 className="mt-3 text-2xl font-black text-slate-950">{plan.name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{plan.audience}</p>
                <div className="mt-5 rounded-3xl bg-slate-50 p-4">
                  <p className="text-3xl font-black text-slate-950">{plan.price}</p>
                </div>
                <p className="mt-5 text-sm leading-6 text-slate-700">{plan.description}</p>

                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckIcon />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan.exclusions && (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Não inclui</p>
                    <ul className="mt-2 space-y-2 text-xs text-slate-600">
                      {plan.exclusions.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  {plan.slug === "gratuito" ? freePlanNotice : legalNotice}
                </p>

                <button
                  type="button"
                  onClick={() => handleCheckout({ type: "subscription", slug: plan.slug, label: plan.name })}
                  disabled={Boolean(loadingKey)}
                  className={`mt-6 rounded-full px-5 py-3 text-sm font-bold shadow-soft transition focus:outline-none focus:ring-4 focus:ring-leaf-200 disabled:cursor-wait disabled:opacity-70 ${
                    plan.highlighted ? "bg-leaf-700 text-white hover:bg-leaf-800" : "bg-leaf-600 text-white hover:bg-leaf-700"
                  }`}
                >
                  {isLoading ? "Preparando checkout..." : plan.buttonLabel}
                </button>
              </article>
            );
          })}
        </div>

        <section className="mt-14 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-leaf-700">Consultorias avulsas</p>
              <h2 className="mt-2 text-3xl font-black text-slate-950">Consultorias Especializadas</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Contrate validações pontuais quando precisar de uma análise revisada, um relatório técnico ou acompanhamento próximo da propriedade.
              </p>
            </div>
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              Endpoint preparado: /api/stripe/create-human-review-checkout
            </p>
          </div>

          <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {consultingServices.map((service) => {
              const buttonKey = `consulting:${service.serviceType}`;
              const isLoading = loadingKey === buttonKey;

              return (
                <article key={service.serviceType} className="flex min-h-full flex-col rounded-3xl border border-leaf-100 bg-gradient-to-b from-white to-leaf-50/70 p-5 shadow-soft">
                  <h3 className="text-lg font-bold text-slate-950">{service.name}</h3>
                  <p className="mt-3 text-2xl font-black text-leaf-800">{service.price}</p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{service.description}</p>
                  <button
                    type="button"
                    onClick={() => handleCheckout({ type: "consulting", slug: service.serviceType, label: service.name })}
                    disabled={Boolean(loadingKey)}
                    className="mt-6 rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-bold text-leaf-700 shadow-sm transition hover:border-leaf-400 hover:bg-leaf-50 disabled:cursor-wait disabled:opacity-70"
                  >
                    {isLoading ? "Preparando análise..." : "Solicitar análise"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

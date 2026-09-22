"use client";

/**
 * Pagina publica de planos.
 *
 * Todo o conteudo vem de `/api/plans` (configuravel na area administrativa).
 * Nenhum preco e escrito aqui, e a categoria "sob consulta" nunca exibe um
 * preco ficticio.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import {
  FREE_PLAN_CODE,
  PlanPagePlan,
  PlanPageService,
  PlansPagePayload,
  TECHNICAL_OPINION_SERVICE_TYPE,
  formatPlanPrice,
  formatServicePrice,
  isFreePlan,
  isQuotePlan
} from "../../lib/plans-page";

type Feedback = { type: "success" | "error" | "info"; message: string; action?: { label: string; href: string } | null };

function CheckIcon() {
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xs font-bold text-leaf-700">
      ✓
    </span>
  );
}

function PlanCard({
  plan,
  legalNotice,
  freePlanNotice,
  onSelect,
  loadingKey
}: {
  plan: PlanPagePlan;
  legalNotice: string;
  freePlanNotice: string;
  onSelect: (plan: PlanPagePlan) => void;
  loadingKey: string | null;
}) {
  const isLoading = loadingKey === `plan:${plan.slug}`;
  const quote = isQuotePlan(plan);

  return (
    <article
      className={`relative flex h-full flex-col rounded-[2rem] border bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl ${
        plan.highlighted ? "border-leaf-500 ring-4 ring-leaf-100 xl:scale-[1.04] xl:p-7" : "border-leaf-100"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-4 left-6 rounded-full bg-leaf-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-soft">
          {plan.badge}
        </span>
      )}
      {plan.eyebrow && <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">{plan.eyebrow}</p>}
      <h3 className="mt-3 text-xl font-black text-slate-950 sm:text-2xl">{plan.name}</h3>
      {plan.audience && <p className="mt-2 text-sm leading-6 text-slate-600 sm:min-h-12">{plan.audience}</p>}

      <div className="mt-5 rounded-3xl bg-slate-50 p-4">
        <p className="text-2xl font-black text-slate-950 sm:text-3xl">{formatPlanPrice(plan)}</p>
        {!quote && plan.price_note && <p className="mt-2 text-xs leading-5 text-slate-500">{plan.price_note}</p>}
      </div>

      {plan.description && <p className="mt-5 text-sm leading-6 text-slate-700">{plan.description}</p>}

      <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.exclusions.length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Nao inclui</p>
          <ul className="mt-2 space-y-2 text-xs text-slate-600">
            {plan.exclusions.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      )}

      {!quote && (
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          {isFreePlan(plan) ? freePlanNotice : legalNotice}
        </p>
      )}

      <button
        type="button"
        onClick={() => onSelect(plan)}
        disabled={Boolean(loadingKey)}
        className={`mt-6 rounded-full px-5 py-3 text-sm font-bold shadow-soft transition focus:outline-none focus:ring-4 focus:ring-leaf-200 disabled:cursor-wait disabled:opacity-70 ${
          plan.highlighted ? "bg-leaf-700 text-white hover:bg-leaf-800" : "bg-leaf-600 text-white hover:bg-leaf-700"
        }`}
      >
        {isLoading ? "Preparando..." : plan.button_label}
      </button>
    </article>
  );
}

export default function PlansPageClient() {
  const [data, setData] = useState<PlansPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetch("/api/plans", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar os planos.");
        return payload as PlansPagePayload;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Nao foi possivel carregar os planos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const singleOpinionService = useMemo<PlanPageService | null>(
    () => data?.services.find((service) => service.service_type === TECHNICAL_OPINION_SERVICE_TYPE) ?? null,
    [data]
  );

  const caseServices = useMemo<PlanPageService[]>(
    () => data?.services.filter((service) => service.service_type !== TECHNICAL_OPINION_SERVICE_TYPE) ?? [],
    [data]
  );

  async function startSubscription(plan: PlanPagePlan) {
    const response = await fetch("/api/stripe/create-subscription-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ planSlug: plan.slug })
    });
    const payload = await response.json().catch(() => null);

    if (payload?.checkoutUrl) {
      setFeedback({ type: "success", message: `Checkout preparado para ${plan.name}. Redirecionando para o pagamento seguro...` });
      window.location.href = payload.checkoutUrl;
      return;
    }

    if (payload?.requiresPlanChange) {
      setFeedback({
        type: "info",
        message: payload.error,
        action: { label: "Ir para Minha assinatura", href: "/minha-assinatura" }
      });
      return;
    }

    if (response.status === 401) {
      setFeedback({
        type: "info",
        message: "Faca login para assinar este plano.",
        action: { label: "Entrar", href: `/login?next=${encodeURIComponent("/planos")}` }
      });
      return;
    }

    setFeedback({
      type: payload?.alreadySubscribed ? "info" : "error",
      message: payload?.error || "Nao foi possivel iniciar esta contratacao.",
      action: payload?.alreadySubscribed ? { label: "Minha assinatura", href: "/minha-assinatura" } : null
    });
  }

  async function handlePlanSelect(plan: PlanPagePlan) {
    setFeedback(null);

    if (isQuotePlan(plan)) {
      window.location.href = "/solicitar-orcamento";
      return;
    }

    if (plan.slug === FREE_PLAN_CODE) {
      window.location.href = "/register";
      return;
    }

    setLoadingKey(`plan:${plan.slug}`);

    try {
      await startSubscription(plan);
    } catch (cause) {
      setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "Nao foi possivel iniciar a contratacao." });
    } finally {
      setLoadingKey(null);
    }
  }

  async function handleSingleOpinion() {
    setFeedback(null);
    setLoadingKey("service:technical_opinion_single");

    try {
      const response = await fetch("/api/stripe/create-technical-opinion-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => null);

      if (payload?.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      }

      if (response.status === 401) {
        setFeedback({
          type: "info",
          message: "Faca login para solicitar um parecer tecnico avulso.",
          action: { label: "Entrar", href: `/login?next=${encodeURIComponent("/planos")}` }
        });
        return;
      }

      setFeedback({ type: "error", message: payload?.error || "Nao foi possivel iniciar o pagamento do parecer avulso." });
    } catch (cause) {
      setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "Nao foi possivel iniciar o pagamento." });
    } finally {
      setLoadingKey(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-16 sm:px-6 lg:px-8" aria-busy="true">
        <div className="rounded-3xl border border-leaf-100 bg-white p-8 text-slate-600 shadow-soft">Carregando planos...</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800" role="alert">
          {error || "Os planos nao estao disponiveis no momento."}
        </div>
      </main>
    );
  }

  const { settings, plans } = data;

  return (
    <main className="bg-gradient-to-b from-leaf-50 via-white to-soil-50/60">
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-6 md:py-20 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-hero-gradient shadow-soft">
          <div className="grid gap-8 p-6 md:p-10 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div>
              {settings.eyebrow && (
                <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-leaf-700 shadow-sm">
                  {settings.eyebrow}
                </p>
              )}
              <SectionTitle title={settings.title} subtitle={settings.subtitle} />
              {settings.intro && <p className="max-w-3xl text-base leading-7 text-slate-700">{settings.intro}</p>}
              <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
                {settings.value_phrases.map((phrase) => (
                  <span
                    key={phrase}
                    className="rounded-full border border-leaf-200 bg-white/85 px-4 py-2 text-sm font-semibold text-leaf-800 shadow-sm"
                  >
                    {phrase}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-soft">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{settings.strategy_label}</p>
              <h2 className="mt-3 text-2xl font-bold text-slate-900">{settings.strategy_title}</h2>
              <div className="mt-5 grid gap-3 text-sm text-slate-700">
                {settings.strategy_items.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl bg-leaf-50 p-3">
                    <CheckIcon />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                {settings.legal_notice}
              </p>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`mt-8 flex flex-col gap-3 rounded-3xl border p-5 text-sm font-medium shadow-soft sm:flex-row sm:items-center sm:justify-between ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : feedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
            role="status"
          >
            <span>{feedback.message}</span>
            {feedback.action && (
              <Link
                href={feedback.action.href}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-center text-sm font-bold text-leaf-700 shadow-sm"
              >
                {feedback.action.label}
              </Link>
            )}
          </div>
        )}

        <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              legalNotice={settings.legal_notice}
              freePlanNotice={settings.free_plan_notice}
              onSelect={handlePlanSelect}
              loadingKey={loadingKey}
            />
          ))}
        </div>

        <section
          id="parecer-avulso"
          className="mt-12 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft md:p-8"
        >
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-black text-slate-950 sm:text-3xl">{settings.onetime_title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{settings.onetime_description}</p>
              {singleOpinionService && (
                <p className="mt-4 text-2xl font-black text-leaf-800">{formatServicePrice(singleOpinionService)}</p>
              )}
            </div>

            {singleOpinionService ? (
              <button
                type="button"
                onClick={handleSingleOpinion}
                disabled={Boolean(loadingKey)}
                className="shrink-0 rounded-full bg-leaf-700 px-6 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-70"
              >
                {loadingKey === "service:technical_opinion_single"
                  ? "Preparando pagamento..."
                  : settings.onetime_button_label}
              </button>
            ) : (
              <p className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Disponibilidade em breve. Fale com a equipe pela pagina de contato.
              </p>
            )}
          </div>
        </section>

        {caseServices.length > 0 && (
          <section className="mt-12 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-leaf-700">{settings.consulting_eyebrow}</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{settings.consulting_title}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{settings.consulting_description}</p>
              </div>
              <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {settings.consulting_notice}
              </p>
            </div>

            <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {caseServices.map((service) => (
                <article
                  key={service.service_type}
                  className="flex min-h-full flex-col rounded-3xl border border-leaf-100 bg-gradient-to-b from-white to-leaf-50/70 p-5 shadow-soft"
                >
                  <h3 className="text-lg font-bold text-slate-950">{service.name}</h3>
                  <p className="mt-3 text-2xl font-black text-leaf-800">{formatServicePrice(service)}</p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{service.description}</p>
                  <Link
                    href="/enviar-caso"
                    className="mt-6 rounded-full border border-leaf-200 bg-white px-5 py-3 text-center text-sm font-bold text-leaf-700 shadow-sm transition hover:border-leaf-400 hover:bg-leaf-50"
                  >
                    {service.button_label}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

"use client";

/**
 * Página publica de planos.
 *
 * Todo o conteudo vem de `/api/plans` (configuravel na área administrativa).
 * Nenhum preço e escrito aqui, e a categoria "sob consulta" nunca exibe um
 * preço ficticio. Os benefícios de parecer agronômico humano de cada plano
 * vêm de `plans.features` (mesma fonte editável dos demais benefícios).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import {
  FREE_PLAN_CODE,
  PlanPagePlan,
  PlansPagePayload,
  formatPlanPrice,
  isFreePlan,
  isQuotePlan
} from "../../lib/plans-page";

/**
 * Atendimento pontual (visitas técnicas, presencial, projetos especiais,
 * demandas fora das assinaturas e orçamento personalizado) é tratado pela
 * página oficial de Contato. Não há mais contratação avulsa nesta página.
 */
const CONTACT_HREF = "/contact";

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
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Não inclui</p>
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
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar os planos.");
        return payload as PlansPagePayload;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os planos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

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
        message: "Faça login para assinar este plano.",
        action: { label: "Entrar", href: `/login?next=${encodeURIComponent("/planos")}` }
      });
      return;
    }

    setFeedback({
      type: payload?.alreadySubscribed ? "info" : "error",
      message: payload?.error || "Não foi possível iniciar esta contratação.",
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
      setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível iniciar a contratação." });
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
          {error || "Os planos não estao disponíveis no momento."}
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
          id="atendimento-pontual"
          aria-labelledby="atendimento-pontual-titulo"
          className="mt-12 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft md:p-8"
        >
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 id="atendimento-pontual-titulo" className="text-2xl font-black text-slate-950 sm:text-3xl">
                {settings.onetime_title}
              </h2>
              {settings.onetime_description && (
                <p className="mt-3 text-sm leading-6 text-slate-600">{settings.onetime_description}</p>
              )}
            </div>

            <Link
              href={CONTACT_HREF}
              className="shrink-0 rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 focus:outline-none focus:ring-4 focus:ring-leaf-200"
            >
              {settings.onetime_button_label || "Falar com a equipe"}
            </Link>
          </div>
        </section>

      </section>
    </main>
  );
}

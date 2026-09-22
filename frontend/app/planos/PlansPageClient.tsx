"use client";

import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import type { PlanPagePlan, PlanPageService, PlansPagePayload } from "../../lib/plans-page";

type CheckoutTarget = { type: "subscription" | "consulting"; slug: string; label: string };
const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatPrice(priceCents: number, prefix: string, period: string) {
  const label = `${prefix ? `${prefix} ` : ""}${brlFormatter.format(priceCents / 100)}`;
  return period ? `${label}/${period}` : label;
}

function CheckIcon() {
  return <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xs font-bold text-leaf-700">✓</span>;
}

function PlanCard({ plan, legalNotice, freePlanNotice, onCheckout, loadingKey }: { plan: PlanPagePlan; legalNotice: string; freePlanNotice: string; onCheckout: (target: CheckoutTarget) => void; loadingKey: string | null }) {
  const isLoading = loadingKey === `subscription:${plan.slug}`;
  return <article className={`relative flex flex-col rounded-[2rem] border bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl ${plan.highlighted ? "border-leaf-500 ring-4 ring-leaf-100 lg:scale-[1.04] lg:p-7" : "border-leaf-100"}`}>
    {plan.badge && <span className="absolute -top-4 left-6 rounded-full bg-leaf-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-soft">{plan.badge}</span>}
    <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">{plan.eyebrow}</p>
    <h3 className="mt-3 text-xl font-black text-slate-950 sm:text-2xl">{plan.name}</h3>
    <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{plan.audience}</p>
    <div className="mt-5 rounded-3xl bg-slate-50 p-4"><p className="text-2xl font-black text-slate-950 sm:text-3xl">{formatPrice(plan.price_cents, plan.price_prefix, plan.price_period)}</p>{plan.price_note && <p className="mt-2 text-xs leading-5 text-slate-500">{plan.price_note}</p>}</div>
    <p className="mt-5 text-sm leading-6 text-slate-700">{plan.description}</p>
    <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2"><CheckIcon /><span>{feature}</span></li>)}</ul>
    {plan.exclusions.length > 0 && <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Não inclui</p><ul className="mt-2 space-y-2 text-xs text-slate-600">{plan.exclusions.map((item) => <li key={item}>• {item}</li>)}</ul></div>}
    <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{plan.slug === "gratuito" ? freePlanNotice : legalNotice}</p>
    <button type="button" onClick={() => onCheckout({ type: "subscription", slug: plan.slug, label: plan.name })} disabled={Boolean(loadingKey)} className={`mt-6 rounded-full px-5 py-3 text-sm font-bold shadow-soft transition focus:outline-none focus:ring-4 focus:ring-leaf-200 disabled:cursor-wait disabled:opacity-70 ${plan.highlighted ? "bg-leaf-700 text-white hover:bg-leaf-800" : "bg-leaf-600 text-white hover:bg-leaf-700"}`}>{isLoading ? "Preparando checkout..." : plan.button_label}</button>
  </article>;
}

function ServiceCard({ service, onCheckout, loadingKey }: { service: PlanPageService; onCheckout: (target: CheckoutTarget) => void; loadingKey: string | null }) {
  const isLoading = loadingKey === `consulting:${service.service_type}`;
  return <article className="flex min-h-full flex-col rounded-3xl border border-leaf-100 bg-gradient-to-b from-white to-leaf-50/70 p-5 shadow-soft"><h3 className="text-lg font-bold text-slate-950">{service.name}</h3><p className="mt-3 text-2xl font-black text-leaf-800">{formatPrice(service.price_cents, service.price_prefix, service.price_period)}</p><p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{service.description}</p><button type="button" onClick={() => onCheckout({ type: "consulting", slug: service.service_type, label: service.name })} disabled={Boolean(loadingKey)} className="mt-6 rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-bold text-leaf-700 shadow-sm transition hover:border-leaf-400 hover:bg-leaf-50 disabled:cursor-wait disabled:opacity-70">{isLoading ? "Preparando análise..." : service.button_label}</button></article>;
}

export default function PlansPageClient() {
  const [data, setData] = useState<PlansPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/plans", { cache: "no-store" }).then(async (response) => { const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar os planos."); return payload as PlansPagePayload; }).then((payload) => { if (active) setData(payload); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os planos."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function handleCheckout(target: CheckoutTarget) {
    setLoadingKey(`${target.type}:${target.slug}`); setFeedback(null);
    if (target.type === "subscription" && target.slug === "gratuito") {
      window.location.href = "/register";
      return;
    }
    const endpoint = target.type === "subscription" ? "/api/stripe/create-subscription-checkout" : "/api/stripe/create-human-review-checkout";
    const payload = target.type === "subscription" ? { planSlug: target.slug } : { serviceType: target.slug, source: "planos" };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
      const responseData = await response.json().catch(() => null);
      if (responseData?.checkoutUrl) { setFeedback({ type: "success", message: `Checkout preparado para ${target.label}. Redirecionando para pagamento seguro...` }); window.location.href = responseData.checkoutUrl; return; }
      setFeedback({ type: response.status === 401 || response.status === 404 ? "info" : "error", message: responseData?.error || (response.status === 401 ? "Faça login para iniciar a contratação." : "Não foi possível iniciar esta contratação.") });
    } catch (cause) { setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível iniciar a contratação." }); } finally { setLoadingKey(null); }
  }

  if (loading) return <main className="mx-auto max-w-7xl px-5 py-16 sm:px-6 lg:px-8" aria-busy="true"><div className="rounded-3xl border border-leaf-100 bg-white p-8 text-slate-600 shadow-soft">Carregando planos...</div></main>;
  if (error || !data) return <main className="mx-auto max-w-7xl px-5 py-16 sm:px-6 lg:px-8"><div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800" role="alert">{error || "Os planos não estão disponíveis no momento."}</div></main>;

  const { settings, plans, services } = data;
  return <main className="bg-gradient-to-b from-leaf-50 via-white to-soil-50/60"><section className="mx-auto max-w-7xl px-5 py-12 sm:px-6 md:py-20 lg:px-8">
    <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-hero-gradient shadow-soft"><div className="grid gap-8 p-6 md:p-10 xl:grid-cols-[1.1fr_0.9fr] xl:items-center"><div><p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-leaf-700 shadow-sm">{settings.eyebrow}</p><SectionTitle title={settings.title} subtitle={settings.subtitle} /><p className="max-w-3xl text-base leading-7 text-slate-700">{settings.intro}</p><div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">{settings.value_phrases.map((phrase) => <span key={phrase} className="rounded-full border border-leaf-200 bg-white/85 px-4 py-2 text-sm font-semibold text-leaf-800 shadow-sm">{phrase}</span>)}</div></div><div className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-soft"><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{settings.strategy_label}</p><h2 className="mt-3 text-2xl font-bold text-slate-900">{settings.strategy_title}</h2><div className="mt-5 grid gap-3 text-sm text-slate-700">{settings.strategy_items.map((item) => <div key={item} className="flex items-start gap-3 rounded-2xl bg-leaf-50 p-3"><CheckIcon /><span>{item}</span></div>)}</div><p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{settings.legal_notice}</p></div></div></div>
    <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-leaf-700">{settings.comparison_label}</p><p className="text-sm text-slate-600">{plans.length} {plans.length === 1 ? "plano disponível" : "planos disponíveis"}. {settings.comparison_description}</p></div>{feedback ? <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${feedback.type === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-800" : feedback.type === "error" ? "border border-red-200 bg-red-50 text-red-700" : "border border-amber-200 bg-amber-50 text-amber-900"}`} role="status">{feedback.message}</div> : <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">Nenhuma solicitação iniciada.</p>}</div>
    <div className="mt-8 grid gap-6 lg:grid-cols-4 lg:items-stretch">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} legalNotice={settings.legal_notice} freePlanNotice={settings.free_plan_notice} onCheckout={handleCheckout} loadingKey={loadingKey} />)}</div>
    {services.length > 0 && <section className="mt-14 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft md:p-8"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-leaf-700">{settings.consulting_eyebrow}</p><h2 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{settings.consulting_title}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{settings.consulting_description}</p></div><p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{settings.consulting_notice}</p></div><div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4">{services.map((service) => <ServiceCard key={service.service_type} service={service} onCheckout={handleCheckout} loadingKey={loadingKey} />)}</div></section>}
  </section></main>;
}

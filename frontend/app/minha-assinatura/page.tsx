"use client";

/**
 * Minha assinatura: plano atual, valor, situacao, próxima cobrança, consultas
 * a IA e pareceres utilizados/restantes, alem do acesso ao Customer Portal do
 * Stripe e a troca de plano (upgrade/downgrade com proration).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";

type SubscriptionSummary = {
  plan: { code: string; name: string; priceCents: number | null; legacyPlanCode: string | null; unlimitedAccess: boolean };
  subscription: {
    state: string;
    stateLabel: string;
    entitled: boolean;
    currentPeriodEnd: string | null;
    nextChargeAt: string | null;
    cancelAtPeriodEnd: boolean;
    hasStripeCustomer: boolean;
  } | null;
  aiUsage: { limit: number | null; used: number; remaining: number | null; periodEnd: string } | null;
  technicalOpinions: {
    limit: number | null;
    used: number;
    remaining: number | null;
    availableCredits: number;
    usageLabel: string;
    remainingLabel: string;
    cycleEnd: string;
  } | null;
};

const PRORATION_NOTICE =
  "A troca de plano usa cobrança proporcional: o Stripe credita o período não utilizado do plano atual e cobra a diferenca do novo plano na próxima fatura.";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR") : "—";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-900">{value}</p>
    </div>
  );
}

export default function MinhaAssinaturaPage() {
  const [data, setData] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/subscription/me", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar sua assinatura.");
      setData(payload as SubscriptionSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar sua assinatura.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPortal() {
    setBusy("portal");
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/stripe/customer-portal", { method: "POST", credentials: "same-origin" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.portalUrl) throw new Error(payload?.error || "Não foi possível abrir o portal.");
      window.location.href = payload.portalUrl;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o portal.");
      setBusy(null);
    }
  }

  async function changePlan(planSlug: string) {
    setBusy(planSlug);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/stripe/change-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ planSlug })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível trocar de plano.");
      }

      setMessage(payload?.message || "Troca solicitada.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível trocar de plano.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16" aria-busy="true">
        <div className="rounded-3xl border border-leaf-100 bg-white p-6 text-slate-600 shadow-soft">Carregando sua assinatura...</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800" role="alert">
          {error || "Assinatura indisponível."}
        </div>
      </section>
    );
  }

  const isPaid = data.plan.code !== "gratuito" && Boolean(data.subscription?.entitled);
  const canUpgrade = data.plan.code !== "consultoria-agronomica";
  const canDowngrade = isPaid && data.plan.code === "consultoria-agronomica";

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-16">
      <SectionTitle title="Minha assinatura" subtitle="Acompanhe seu plano, seu consumo e sua próxima cobrança." />

      {message && (
        <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoRow label="Plano atual" value={data.plan.name} />
          <InfoRow
            label="Valor"
            value={data.plan.priceCents ? `${brl.format(data.plan.priceCents / 100)}/mês` : "Sem cobrança recorrente"}
          />
          <InfoRow label="Situacao" value={data.subscription?.stateLabel ?? "Sem assinatura"} />
          <InfoRow
            label={data.subscription?.cancelAtPeriodEnd ? "Acesso até" : "Próxima cobrança"}
            value={formatDate(data.subscription?.cancelAtPeriodEnd ? data.subscription.currentPeriodEnd : data.subscription?.nextChargeAt)}
          />
        </div>

        {data.plan.legacyPlanCode && (
          <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            Sua assinatura foi contratada em um plano anterior e foi preservada exatamente como estava. O valor cobrado não
            mudou, e você mantem os recursos equivalentes na nova estrutura.
          </p>
        )}

        {data.subscription?.state === "past_due" && (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
            Identificamos uma falha no último pagamento. Atualize a forma de pagamento para reativar os recursos do plano.
          </p>
        )}

        {data.subscription?.cancelAtPeriodEnd && (
          <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            O cancelamento esta agendado. Você continua com todos os recursos até o fim do período já pago e depois volta
            automaticamente para o plano Gratuito.
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft">
          <h2 className="text-lg font-bold text-slate-950">Consultas a IA</h2>
          {data.aiUsage ? (
            <>
              <p className="mt-3 text-2xl font-black text-leaf-800">
                {data.aiUsage.limit === null ? `${data.aiUsage.used} neste ciclo` : `${data.aiUsage.used} de ${data.aiUsage.limit}`}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {data.aiUsage.limit === null
                  ? "Sem teto numerico, conforme a política de uso da plataforma."
                  : `Reinicia em ${formatDate(data.aiUsage.periodEnd)}.`}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Consumo indisponível no momento.</p>
          )}
        </div>

        <div className="rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft">
          <h2 className="text-lg font-bold text-slate-950">Pareceres agronômicos humanos</h2>
          {data.technicalOpinions ? (
            <>
              <p className="mt-3 text-2xl font-black text-leaf-800">{data.technicalOpinions.usageLabel}</p>
              <p className="mt-2 text-sm text-slate-600">{data.technicalOpinions.remainingLabel}</p>
              {data.technicalOpinions.availableCredits > 0 && (
                <p className="mt-2 text-sm font-semibold text-emerald-700">
                  Você também possui {data.technicalOpinions.availableCredits} parecer(es) avulso(s) pago(s) disponível(is).
                </p>
              )}
              <Link href="/pareceres" className="mt-4 inline-flex text-sm font-bold text-leaf-700">
                Ver meus pareceres →
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Saldo indisponível no momento.</p>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:p-8">
        <h2 className="text-lg font-bold text-slate-950">Gerenciar assinatura</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{PRORATION_NOTICE}</p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {data.subscription?.hasStripeCustomer && (
            <button
              type="button"
              onClick={openPortal}
              disabled={Boolean(busy)}
              className="rounded-full bg-leaf-700 px-6 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-70"
            >
              {busy === "portal" ? "Abrindo..." : "Gerenciar assinatura"}
            </button>
          )}

          {isPaid && canUpgrade && (
            <button
              type="button"
              onClick={() => changePlan("consultoria-agronomica")}
              disabled={Boolean(busy)}
              className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-bold text-leaf-700 shadow-sm transition hover:bg-leaf-50 disabled:cursor-wait disabled:opacity-70"
            >
              {busy === "consultoria-agronomica" ? "Solicitando..." : "Migrar para Consultoria Agronômica"}
            </button>
          )}

          {canDowngrade && (
            <button
              type="button"
              onClick={() => changePlan("ia-profissional")}
              disabled={Boolean(busy)}
              className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
            >
              {busy === "ia-profissional" ? "Solicitando..." : "Migrar para IA Profissional"}
            </button>
          )}

          {!isPaid && (
            <Link
              href="/planos"
              className="rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800"
            >
              Conhecer os planos
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

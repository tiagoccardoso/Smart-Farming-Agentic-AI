/**
 * Ciclos de cobranca usados para reiniciar contadores.
 *
 * - Consultas a IA usam o ciclo de calendario (mes UTC). E o "ciclo mensal
 *   definido pelo sistema" ja adotado por `usage_events`; manter assim preserva
 *   todo o historico de uso ja gravado.
 * - Pareceres tecnicos usam o ciclo real da assinatura quando ele existe, para
 *   que "3 pareceres por ciclo" acompanhe a data de cobranca do assinante.
 */

import type { ResolvedSubscription } from "./entitlements";

export type BillingCycleSource = "subscription" | "calendar";

export type BillingCycle = {
  /** Identificador estavel do ciclo, gravado em technical_opinions.billing_cycle_reference. */
  reference: string;
  start: string;
  end: string;
  source: BillingCycleSource;
};

export function getCalendarMonthCycle(now = new Date()): BillingCycle {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const month = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;

  return {
    reference: `cal:${month}`,
    start: start.toISOString(),
    end: end.toISOString(),
    source: "calendar"
  };
}

/** Compatibilidade com o formato ja gravado em `usage_events`. */
export function getCurrentMonthlyPeriod(now = new Date()) {
  const cycle = getCalendarMonthCycle(now);
  return { periodStart: cycle.start, periodEnd: cycle.end };
}

function isValidDate(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

export function resolveSubscriptionCycle(
  subscription: ResolvedSubscription | null | undefined,
  now = new Date()
): BillingCycle {
  if (
    subscription?.entitled &&
    isValidDate(subscription.currentPeriodStart) &&
    isValidDate(subscription.currentPeriodEnd)
  ) {
    const start = new Date(subscription.currentPeriodStart as string).toISOString();
    const end = new Date(subscription.currentPeriodEnd as string).toISOString();

    return {
      reference: `sub:${subscription.id}:${start}`,
      start,
      end,
      source: "subscription"
    };
  }

  return getCalendarMonthCycle(now);
}

export function formatCycleEnd(cycle: BillingCycle) {
  return new Date(cycle.end).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Mapeamento entre os status do Stripe e o estado interno da PlantaSa.
 *
 * A aplicacao nunca libera um plano apenas porque existe `stripe_subscription_id`.
 * O que libera recursos é `isEntitledState(state) === true`.
 */

export type InternalSubscriptionState =
  | "active"
  | "trialing"
  | "payment_pending"
  | "past_due"
  | "scheduled_cancellation"
  | "canceled"
  | "incomplete"
  | "ended";

/** Estados internos que dao direito aos recursos do plano. */
const ENTITLED_STATES = new Set<InternalSubscriptionState>(["active", "trialing", "scheduled_cancellation"]);

const STRIPE_STATUS_MAP: Record<string, InternalSubscriptionState> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "ended",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "ended",
  paused: "payment_pending",
  // Status interno gravado antes do usuário concluir o Checkout.
  checkout_pending: "payment_pending"
};

export const SUBSCRIPTION_STATE_LABELS: Record<InternalSubscriptionState, string> = {
  active: "Ativa",
  trialing: "Período de teste",
  payment_pending: "Pagamento pendente",
  past_due: "Pagamento em atraso",
  scheduled_cancellation: "Cancelamento agendado",
  canceled: "Cancelada",
  incomplete: "Incompleta",
  ended: "Encerrada"
};

export function mapStripeSubscriptionStatus(
  stripeStatus: string | null | undefined,
  cancelAtPeriodEnd = false
): InternalSubscriptionState {
  const normalized = (stripeStatus ?? "").trim().toLowerCase();
  const mapped = STRIPE_STATUS_MAP[normalized];

  if (!mapped) {
    return "incomplete";
  }

  if (cancelAtPeriodEnd && (mapped === "active" || mapped === "trialing")) {
    return "scheduled_cancellation";
  }

  return mapped;
}

export function isEntitledState(state: InternalSubscriptionState | null | undefined) {
  return Boolean(state && ENTITLED_STATES.has(state));
}

/**
 * Uma assinatura só dá direito se o estado permitir E o período atual não
 * tiver expirado. Assinaturas sem `current_period_end` (ex.: recem-criadas)
 * seguem o estado.
 */
export function isSubscriptionEntitled(
  state: InternalSubscriptionState | null | undefined,
  currentPeriodEnd: string | null | undefined,
  now = new Date()
) {
  if (!isEntitledState(state)) {
    return false;
  }

  if (!currentPeriodEnd) {
    return true;
  }

  const periodEnd = new Date(currentPeriodEnd).getTime();
  return Number.isFinite(periodEnd) ? periodEnd > now.getTime() : true;
}

export function describeSubscriptionState(state: InternalSubscriptionState | null | undefined) {
  return state ? SUBSCRIPTION_STATE_LABELS[state] : "Sem assinatura";
}

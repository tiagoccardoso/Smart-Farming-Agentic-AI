/**
 * Parecer agronômico humano como benefício mensal do plano.
 *
 * Regra comercial (fonte de verdade: `plans.entitlements.TECHNICAL_OPINIONS_MONTHLY`):
 *   - PlantaSa IA Profissional ........ 1 parecer por ciclo
 *   - PlantaSa Consultoria Agronômica . até 3 pareceres por ciclo
 *   - Demais planos ................... sem acesso
 *
 * Tudo aqui roda no servidor. Plano, limite, saldo e estado da assinatura são
 * sempre resolvidos a partir do banco — nunca a partir do que o navegador envia.
 *
 * Ciclo: o período vigente da assinatura (`current_period_start`/`end`,
 * espelhado do Stripe pelo webhook). Sem período conhecido, cai no mês UTC.
 * Consumo: pareceres de franquia (origin = subscription) não cancelados criados
 * dentro da janela do ciclo. A mesma contagem é feita, sob lock, dentro da
 * função `request_case_human_opinion` no Postgres.
 */

import { supabaseAdminRequest } from "../server/supabaseAdmin";
import { BillingCycle, resolveSubscriptionCycle } from "./billing-cycle";
import type { ResolvedAccess } from "./entitlements";
import type { TechnicalOpinion } from "./technical-opinions";

/** Limite técnico usado apenas para usuários com acesso ilimitado. */
const UNLIMITED_OPINIONS = 1_000_000;

const SAO_PAULO_DATE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export type HumanOpinionReason = "eligible" | "limit_reached" | "plan_without_benefit" | "inactive_profile";

export type HumanOpinionStatus = {
  eligible: boolean;
  reason: HumanOpinionReason;
  planCode: string;
  planName: string;
  unlimited: boolean;
  /** Franquia do ciclo; null quando o acesso é ilimitado. */
  limit: number | null;
  used: number;
  /** Saldo do ciclo; null quando o acesso é ilimitado. */
  remaining: number | null;
  cycle: BillingCycle;
  /** Data confiável de renovação do benefício (fim do período pago), quando existe. */
  renewsAt: string | null;
  /** Assinatura com cancelamento agendado: benefício vale até esta data e não renova. */
  benefitEndsAt: string | null;
  /** Ex.: "Pareceres disponíveis neste mês: 2 de 3". */
  balanceLabel: string;
  /** Explicação pronta para a interface. */
  message: string;
};

export class HumanOpinionUnavailableError extends Error {
  status: number;
  reason: HumanOpinionReason | "case_not_found" | "case_not_eligible";
  opinionStatus: HumanOpinionStatus | null;

  constructor(
    message: string,
    status: number,
    reason: HumanOpinionUnavailableError["reason"],
    opinionStatus: HumanOpinionStatus | null = null
  ) {
    super(message);
    this.name = "HumanOpinionUnavailableError";
    this.status = status;
    this.reason = reason;
    this.opinionStatus = opinionStatus;
  }
}

export function formatDateBR(value: string) {
  return SAO_PAULO_DATE.format(new Date(value));
}

/** Aceita apenas chaves opacas geradas pelo cliente (ex.: crypto.randomUUID()). */
export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim();
  return /^[A-Za-z0-9_-]{8,120}$/.test(key) ? key : null;
}

export async function countHumanOpinionsInCycle(userId: string, cycle: BillingCycle) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/technical_opinions?user_id=eq.${encodeURIComponent(userId)}&origin=eq.subscription&status=neq.cancelado&created_at=gte.${encodeURIComponent(cycle.start)}&created_at=lt.${encodeURIComponent(cycle.end)}&select=id`,
    { method: "GET" }
  );

  return rows.length;
}

function describeRenewal(renewsAt: string | null, benefitEndsAt: string | null) {
  if (renewsAt) {
    return `Seu benefício será renovado em ${formatDateBR(renewsAt)}.`;
  }
  if (benefitEndsAt) {
    return `Sua assinatura está com cancelamento agendado para ${formatDateBR(benefitEndsAt)}; o benefício não será renovado.`;
  }
  return "Um novo parecer estará disponível no próximo ciclo da sua assinatura.";
}

export async function getHumanOpinionStatus(access: ResolvedAccess, now = new Date()): Promise<HumanOpinionStatus> {
  const cycle = resolveSubscriptionCycle(access.subscription, now);
  const unlimited = access.unlimitedAccess;
  const limit = unlimited ? null : Math.max(0, access.entitlements.TECHNICAL_OPINIONS_MONTHLY);
  const subscription = access.subscription?.entitled ? access.subscription : null;
  const fromSubscription = cycle.source === "subscription" && Boolean(subscription);
  const renewsAt = fromSubscription && !subscription?.cancelAtPeriodEnd ? cycle.end : null;
  const benefitEndsAt = fromSubscription && subscription?.cancelAtPeriodEnd ? cycle.end : null;

  const base = {
    planCode: access.planCode,
    planName: access.planName,
    unlimited,
    cycle,
    renewsAt,
    benefitEndsAt
  };

  if (!access.profileActive) {
    return {
      ...base,
      eligible: false,
      reason: "inactive_profile",
      limit: limit ?? 0,
      used: 0,
      remaining: 0,
      balanceLabel: "",
      message: "Usuário inativo. Entre em contato com o suporte."
    };
  }

  if (limit === 0) {
    return {
      ...base,
      eligible: false,
      reason: "plan_without_benefit",
      limit: 0,
      used: 0,
      remaining: 0,
      balanceLabel: "",
      message:
        "O envio de caso para parecer agronômico humano está disponível nos planos PlantaSa IA Profissional e PlantaSa Consultoria Agronômica."
    };
  }

  const used = await countHumanOpinionsInCycle(access.userId, cycle);

  if (limit === null) {
    return {
      ...base,
      eligible: true,
      reason: "eligible",
      limit: null,
      used,
      remaining: null,
      balanceLabel: "Pareceres disponíveis neste mês: sem limite",
      message: "Seu acesso permite enviar casos para parecer sem limite mensal."
    };
  }

  const remaining = Math.max(0, limit - used);
  const balanceLabel = `Pareceres disponíveis neste mês: ${remaining} de ${limit}`;

  if (remaining === 0) {
    const usedText =
      limit === 1
        ? "Você já utilizou o seu parecer disponível neste ciclo."
        : `Você já utilizou os ${limit} pareceres disponíveis neste ciclo.`;

    return {
      ...base,
      eligible: false,
      reason: "limit_reached",
      limit,
      used,
      remaining,
      balanceLabel,
      message: `${usedText} ${describeRenewal(renewsAt, benefitEndsAt)}`
    };
  }

  return {
    ...base,
    eligible: true,
    reason: "eligible",
    limit,
    used,
    remaining,
    balanceLabel,
    message:
      remaining === 1
        ? "Você possui 1 parecer agronômico humano disponível neste ciclo."
        : `Você possui ${remaining} pareceres agronômicos humanos disponíveis neste ciclo.`
  };
}

/** Status HTTP de um bloqueio: 403 para perfil inativo, 402 para plano/limite. */
export function statusCodeFor(status: HumanOpinionStatus) {
  return status.reason === "inactive_profile" ? 403 : 402;
}

export async function findOpinionByIdempotencyKey(userId: string, idempotencyKey: string) {
  const rows = await supabaseAdminRequest<TechnicalOpinion[]>(
    `/rest/v1/technical_opinions?user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,case_id,status,origin,created_at&limit=1`,
    { method: "GET" }
  );

  return rows[0] ?? null;
}

export type RequestCaseHumanOpinionInput = {
  access: ResolvedAccess;
  caseId: string;
  idempotencyKey: string | null;
  title: string;
  description: string;
};

export type RequestCaseHumanOpinionResult = {
  opinion: TechnicalOpinion;
  replayed: boolean;
  status: HumanOpinionStatus;
};

type RpcResult = { opinion?: TechnicalOpinion; replayed?: boolean } | null;

/**
 * Consome 1 parecer do ciclo e coloca o caso na fila da especialista.
 *
 * A checagem abaixo serve para responder rápido e com mensagem amigável. A
 * garantia real está no Postgres: `request_case_human_opinion` serializa o
 * usuário com advisory lock, reconta o consumo na janela do ciclo, aplica a
 * idempotência (chave e caso) e grava parecer + fila + caso na MESMA transação.
 * Falhou qualquer passo, nada é consumido.
 */
export async function requestHumanOpinionForCase(
  input: RequestCaseHumanOpinionInput
): Promise<RequestCaseHumanOpinionResult> {
  const { access } = input;

  if (input.idempotencyKey) {
    const previous = await findOpinionByIdempotencyKey(access.userId, input.idempotencyKey);
    if (previous) {
      return { opinion: previous, replayed: true, status: await getHumanOpinionStatus(access) };
    }
  }

  const status = await getHumanOpinionStatus(access);

  if (!status.eligible) {
    throw new HumanOpinionUnavailableError(status.message, statusCodeFor(status), status.reason, status);
  }

  let result: RpcResult;

  try {
    result = await supabaseAdminRequest<RpcResult>("/rest/v1/rpc/request_case_human_opinion", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: access.userId,
        p_case_id: input.caseId,
        p_idempotency_key: input.idempotencyKey,
        p_subscription_id: access.subscription?.entitled ? access.subscription.id : null,
        p_plan_code: access.planCode,
        p_monthly_limit: status.limit === null ? UNLIMITED_OPINIONS : status.limit,
        p_cycle_reference: status.cycle.reference,
        p_cycle_start: status.cycle.start,
        p_cycle_end: status.cycle.end,
        p_title: input.title,
        p_description: input.description
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("HUMAN_OPINION_LIMIT_REACHED")) {
      // Outra requisição consumiu o último parecer entre a checagem e a gravação.
      const fresh = await getHumanOpinionStatus(access);
      const blocked = fresh.eligible ? { ...fresh, eligible: false, reason: "limit_reached" as const } : fresh;
      throw new HumanOpinionUnavailableError(blocked.message, 402, "limit_reached", blocked);
    }
    if (message.includes("CASE_NOT_FOUND")) {
      throw new HumanOpinionUnavailableError("Caso não encontrado.", 404, "case_not_found");
    }
    if (message.includes("CASE_NOT_ELIGIBLE") || message.includes("CASE_ALREADY_IN_REVIEW")) {
      throw new HumanOpinionUnavailableError(
        "Este caso já foi enviado para parecer ou não pode mais receber uma nova solicitação.",
        409,
        "case_not_eligible"
      );
    }
    throw error;
  }

  if (!result?.opinion?.id) {
    throw new Error("A solicitação de parecer não retornou um registro válido.");
  }

  return {
    opinion: result.opinion,
    replayed: Boolean(result.replayed),
    status: await getHumanOpinionStatus(access)
  };
}

/** Formato público (sem IDs internos de ciclo) enviado ao navegador. */
export function toPublicHumanOpinionStatus(status: HumanOpinionStatus) {
  return {
    eligible: status.eligible,
    reason: status.reason,
    planCode: status.planCode,
    planName: status.planName,
    unlimited: status.unlimited,
    limit: status.limit,
    used: status.used,
    remaining: status.remaining,
    cycleStart: status.cycle.start,
    cycleEnd: status.cycle.end,
    cycleSource: status.cycle.source,
    renewsAt: status.renewsAt,
    benefitEndsAt: status.benefitEndsAt,
    balanceLabel: status.balanceLabel,
    message: status.message
  };
}

export type PublicHumanOpinionStatus = ReturnType<typeof toPublicHumanOpinionStatus>;

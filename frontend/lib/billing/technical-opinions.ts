/**
 * Pareceres técnicos (demandas técnicas).
 *
 * Regra comercial: 1 parecer = 1 demanda técnica. Mensagens, perguntas, fotos,
 * documentos, análises e respostas complementares da MESMA demanda não
 * consomem novo parecer. O parecer é consumido no momento em que a demanda e
 * criada.
 */

import { supabaseAdminRequest } from "../server/supabaseAdmin";
import { BillingCycle, resolveSubscriptionCycle } from "./billing-cycle";
import { ResolvedAccess } from "./entitlements";

export type TechnicalOpinionStatus =
  | "aberto"
  | "em_analise"
  | "aguardando_informacoes"
  | "respondido"
  | "concluido"
  | "cancelado";

export const TECHNICAL_OPINION_STATUS_LABELS: Record<TechnicalOpinionStatus, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  aguardando_informacoes: "Aguardando informações",
  respondido: "Respondido",
  concluido: "Concluído",
  cancelado: "Cancelado"
};

export const TECHNICAL_OPINION_STATUSES = Object.keys(TECHNICAL_OPINION_STATUS_LABELS) as TechnicalOpinionStatus[];

export function isTechnicalOpinionStatus(value: unknown): value is TechnicalOpinionStatus {
  return typeof value === "string" && (TECHNICAL_OPINION_STATUSES as string[]).includes(value);
}

export type TechnicalOpinion = {
  id: string;
  user_id: string;
  property_id: string | null;
  subscription_id: string | null;
  case_id: string | null;
  credit_id: string | null;
  origin: "subscription" | "one_time";
  title: string;
  description: string;
  status: TechnicalOpinionStatus;
  assigned_specialist_id: string | null;
  billing_cycle_reference: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type TechnicalOpinionMessage = {
  id: string;
  opinion_id: string;
  author_id: string | null;
  author_role: "client" | "specialist" | "admin" | "system";
  body: string;
  attachments: string[];
  created_at: string;
};

export type TechnicalOpinionBalance = {
  /** Franquia do plano no ciclo. */
  limit: number;
  used: number;
  remaining: number;
  /** Créditos avulsos pagos e ainda não consumidos. */
  availableCredits: number;
  cycle: BillingCycle;
  canOpen: boolean;
  /** Texto pronto para a interface, ex.: "Pareceres utilizados neste ciclo: 1 de 3". */
  usageLabel: string;
  remainingLabel: string;
};

export class TechnicalOpinionLimitError extends Error {
  status = 402;
  balance?: TechnicalOpinionBalance;

  constructor(balance?: TechnicalOpinionBalance) {
    super(
      balance && balance.limit > 0
        ? `Você utilizou os ${balance.limit} pareceres técnicos disponíveis neste ciclo.`
        : "Seu plano atual não inclui pareceres técnicos."
    );
    this.name = "TechnicalOpinionLimitError";
    this.balance = balance;
  }
}

const OPINION_SELECT =
  "id,user_id,property_id,subscription_id,case_id,credit_id,origin,title,description,status,assigned_specialist_id,billing_cycle_reference,cycle_start,cycle_end,created_at,updated_at,closed_at";

async function countOpinionsInCycle(userId: string, cycle: BillingCycle) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    // Mesma janela usada pelo Postgres (request_case_human_opinion / create_technical_opinion):
    // após upgrade/downgrade no meio do período o consumo do ciclo é preservado.
    `/rest/v1/technical_opinions?user_id=eq.${encodeURIComponent(userId)}&origin=eq.subscription&status=neq.cancelado&created_at=gte.${encodeURIComponent(cycle.start)}&created_at=lt.${encodeURIComponent(cycle.end)}&select=id`,
    { method: "GET" }
  );

  return rows.length;
}

async function countAvailableCredits(userId: string) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/technical_opinion_credits?user_id=eq.${encodeURIComponent(userId)}&status=eq.available&select=id`,
    { method: "GET" }
  );

  return rows.length;
}

export async function getTechnicalOpinionBalance(access: ResolvedAccess): Promise<TechnicalOpinionBalance> {
  const cycle = resolveSubscriptionCycle(access.subscription);
  const rawLimit = access.entitlements.TECHNICAL_OPINIONS_MONTHLY;
  const limit = access.unlimitedAccess ? Number.MAX_SAFE_INTEGER : rawLimit;
  const [used, availableCredits] = await Promise.all([
    limit > 0 ? countOpinionsInCycle(access.userId, cycle) : Promise.resolve(0),
    countAvailableCredits(access.userId)
  ]);
  const remaining = Math.max(0, limit - used);

  return {
    limit,
    used,
    remaining,
    availableCredits,
    cycle,
    canOpen: remaining > 0 || availableCredits > 0,
    usageLabel: access.unlimitedAccess
      ? "Pareceres técnicos sem limite neste ciclo."
      : `Pareceres utilizados neste ciclo: ${used} de ${limit}`,
    remainingLabel: access.unlimitedAccess
      ? "Pareceres técnicos sem limite neste ciclo."
      : remaining === 1
        ? "Você possui 1 parecer disponível neste ciclo."
        : `Você possui ${remaining} pareceres disponíveis neste ciclo.`
  };
}

export type CreateTechnicalOpinionInput = {
  access: ResolvedAccess;
  title: string;
  description: string;
  propertyId?: string | null;
  caseId?: string | null;
};

/**
 * Abre uma demanda técnica. A contagem e a baixa do crédito acontecem dentro de
 * uma funcao do Postgres (`create_technical_opinion`), de forma atômica, para
 * que duas requisicoes simultâneas não abram o quarto parecer nem consumam o
 * mesmo crédito duas vezes.
 */
export async function createTechnicalOpinion(input: CreateTechnicalOpinionInput): Promise<TechnicalOpinion> {
  const balance = await getTechnicalOpinionBalance(input.access);

  if (!balance.canOpen) {
    throw new TechnicalOpinionLimitError(balance);
  }

  try {
    const created = await supabaseAdminRequest<TechnicalOpinion | TechnicalOpinion[]>(
      "/rest/v1/rpc/create_technical_opinion",
      {
        method: "POST",
        body: JSON.stringify({
          p_user_id: input.access.userId,
          p_title: input.title,
          p_description: input.description,
          p_property_id: input.propertyId ?? null,
          p_case_id: input.caseId ?? null,
          p_subscription_id: input.access.subscription?.entitled ? input.access.subscription.id : null,
          p_monthly_limit: Math.min(balance.limit, 1_000_000),
          p_cycle_reference: balance.cycle.reference,
          p_cycle_start: balance.cycle.start,
          p_cycle_end: balance.cycle.end
        })
      }
    );

    const opinion = Array.isArray(created) ? created[0] : created;

    if (!opinion?.id) {
      throw new Error("Não foi possível registrar a demanda técnica.");
    }

    return opinion;
  } catch (error) {
    if (error instanceof Error && error.message.includes("TECHNICAL_OPINION_LIMIT_REACHED")) {
      throw new TechnicalOpinionLimitError(balance);
    }
    throw error;
  }
}

export async function listTechnicalOpinions(userId: string, limit = 50) {
  const normalized = Math.min(200, Math.max(1, Math.floor(limit)));

  return supabaseAdminRequest<TechnicalOpinion[]>(
    `/rest/v1/technical_opinions?user_id=eq.${encodeURIComponent(userId)}&select=${OPINION_SELECT}&order=created_at.desc&limit=${normalized}`,
    { method: "GET" }
  );
}

export async function getTechnicalOpinion(opinionId: string) {
  const rows = await supabaseAdminRequest<TechnicalOpinion[]>(
    `/rest/v1/technical_opinions?id=eq.${encodeURIComponent(opinionId)}&select=${OPINION_SELECT}&limit=1`,
    { method: "GET" }
  );

  return rows[0] ?? null;
}

export async function listTechnicalOpinionMessages(opinionId: string) {
  return supabaseAdminRequest<TechnicalOpinionMessage[]>(
    `/rest/v1/technical_opinion_messages?opinion_id=eq.${encodeURIComponent(opinionId)}&select=id,opinion_id,author_id,author_role,body,attachments,created_at&order=created_at.asc&limit=500`,
    { method: "GET" }
  );
}

/**
 * Mensagens não consomem pareceres: apenas a criação da demanda consome.
 */
export async function addTechnicalOpinionMessage(input: {
  opinionId: string;
  authorId: string;
  authorRole: TechnicalOpinionMessage["author_role"];
  body: string;
  attachments?: string[];
}) {
  const rows = await supabaseAdminRequest<TechnicalOpinionMessage[]>(
    "/rest/v1/technical_opinion_messages?select=id,opinion_id,author_id,author_role,body,attachments,created_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        opinion_id: input.opinionId,
        author_id: input.authorId,
        author_role: input.authorRole,
        body: input.body,
        attachments: input.attachments ?? []
      })
    }
  );

  return rows[0] ?? null;
}

export async function updateTechnicalOpinionStatus(opinionId: string, status: TechnicalOpinionStatus) {
  await supabaseAdminRequest(`/rest/v1/technical_opinions?id=eq.${encodeURIComponent(opinionId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      closed_at: status === "concluido" || status === "cancelado" ? new Date().toISOString() : null
    })
  });
}

/**
 * Libera exatamente 1 parecer avulso após a confirmação do pagamento.
 * A unicidade de `stripe_checkout_session_id` e de `one_time_order_id` no banco
 * garante que o mesmo pagamento nunca libere dois pareceres.
 */
export async function grantTechnicalOpinionCredit(input: {
  userId: string;
  oneTimeOrderId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  amountCents?: number | null;
}) {
  const existing = input.stripeCheckoutSessionId
    ? await supabaseAdminRequest<Array<{ id: string }>>(
        `/rest/v1/technical_opinion_credits?stripe_checkout_session_id=eq.${encodeURIComponent(input.stripeCheckoutSessionId)}&select=id&limit=1`,
        { method: "GET" }
      )
    : [];

  if (existing[0]?.id) {
    return { granted: false, creditId: existing[0].id, reason: "already_granted" as const };
  }

  try {
    const rows = await supabaseAdminRequest<Array<{ id: string }>>(
      "/rest/v1/technical_opinion_credits?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: input.userId,
          source: "stripe_one_time",
          one_time_order_id: input.oneTimeOrderId ?? null,
          stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
          stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
          amount_cents: input.amountCents ?? null,
          status: "available"
        })
      }
    );

    return { granted: true, creditId: rows[0]?.id ?? null, reason: "granted" as const };
  } catch (error) {
    // Colisao no índice único = webhook duplicado. Idempotente por construcao.
    if (error instanceof Error && /duplicate key|unique constraint/i.test(error.message)) {
      return { granted: false, creditId: null, reason: "already_granted" as const };
    }
    throw error;
  }
}

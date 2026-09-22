/**
 * Controle de limites de uso por plano.
 *
 * Esta camada NAO conhece regras comerciais: ela apenas traduz um tipo de
 * evento de uso para o direito correspondente em `lib/billing/entitlements.ts`.
 * Alterar "3 consultas" para "5 consultas" e uma alteração de dado em
 * `plans.entitlements`, feita pela área administrativa.
 */

import { getCurrentMonthlyPeriod } from "./billing-cycle";
import { Entitlements, ResolvedAccess, resolveUserAccess } from "./entitlements";
import { supabaseAdminRequest } from "../server/supabaseAdmin";

export type UsageEventType = "ai_question" | "case_analysis" | "image_triage" | "pdf_report" | "human_review";

export type PlanFeature = "photo_upload" | "soil_analysis_upload" | "simple_history";
export type QuestionHistorySource = "qa" | "agronomic_case";

type UsageLimit = number | null;

type UsageEventRow = {
  count: number | null;
};

type QuestionHistoryInput = {
  userId: string;
  question: string;
  answer?: string | null;
  source?: QuestionHistorySource;
  caseId?: string | null;
};

export type QuestionHistoryEntry = {
  id: string;
  case_id: string | null;
  source: QuestionHistorySource;
  question: string;
  answer: string | null;
  created_at: string | null;
};

export type PlanLimitCheckResult = {
  allowed: boolean;
  userId: string;
  planSlug: string;
  planLabel: string;
  eventType: UsageEventType;
  limit: UsageLimit;
  used: number;
  remaining: UsageLimit;
  periodStart: string;
  periodEnd: string;
  unlimitedAccess?: boolean;
  /** Mensagem explicativa pronta para a interface. */
  message?: string;
  /** Chamada para acao sugerida quando o limite e atingido. */
  cta?: { label: string; href: string } | null;
};

export const PLAN_LIMIT_REACHED_MESSAGE = "Você atingiu o limite do seu plano neste ciclo.";

/** Traduz um evento de uso no direito do plano que o autoriza. */
function resolveLimit(eventType: UsageEventType, entitlements: Entitlements): UsageLimit {
  switch (eventType) {
    case "ai_question":
      return entitlements.AI_MONTHLY_LIMIT;
    case "case_analysis":
      return entitlements.CASE_ANALYSIS_MONTHLY;
    case "image_triage":
      return entitlements.AI_IMAGES ? entitlements.IMAGE_TRIAGE_MONTHLY : 0;
    case "pdf_report":
      return entitlements.REPORTS ? null : 0;
    case "human_review":
      return entitlements.HUMAN_VALIDATION ? null : 0;
    default:
      return 0;
  }
}

const UPGRADE_CTA = { label: "Conhecer IA Profissional", href: "/planos" };
const CONSULTING_CTA = { label: "Quero Consultoria Agronômica", href: "/planos" };

/**
 * Mensagens explicam o motivo da restrição. Nunca "Você não possui permissão."
 */
function buildLimitMessage(
  eventType: UsageEventType,
  planLabel: string,
  limit: UsageLimit,
  used: number
): { message: string; cta: { label: string; href: string } | null } {
  if (limit === 0) {
    if (eventType === "image_triage") {
      return {
        message: `Seu plano ${planLabel} não inclui análise de fotos pela IA.`,
        cta: UPGRADE_CTA
      };
    }
    if (eventType === "pdf_report") {
      return {
        message: `Seu plano ${planLabel} não inclui relatórios e recomendações em PDF.`,
        cta: UPGRADE_CTA
      };
    }
    if (eventType === "human_review") {
      return {
        message: `Seu plano ${planLabel} não inclui validação por especialista.`,
        cta: CONSULTING_CTA
      };
    }
    return { message: `Seu plano ${planLabel} não inclui este recurso.`, cta: UPGRADE_CTA };
  }

  if (eventType === "ai_question") {
    return {
      message: `Seu plano ${planLabel} inclui ${limit} consultas a IA por mês. Você já utilizou as ${used} consultas deste ciclo.`,
      cta: UPGRADE_CTA
    };
  }

  return {
    message: `Seu plano ${planLabel} inclui ${limit} usos deste recurso por ciclo. Você já utilizou ${used}.`,
    cta: UPGRADE_CTA
  };
}

export class PlanLimitExceededError extends Error {
  status: number;
  result?: PlanLimitCheckResult;

  constructor(result?: PlanLimitCheckResult) {
    super(result?.message || PLAN_LIMIT_REACHED_MESSAGE);
    this.name = "PlanLimitExceededError";
    this.status = 402;
    this.result = result;
  }
}

export class PlanFeatureUnavailableError extends Error {
  status: number;
  cta: { label: string; href: string } | null;

  constructor(message = PLAN_LIMIT_REACHED_MESSAGE, cta: { label: string; href: string } | null = UPGRADE_CTA) {
    super(message);
    this.name = "PlanFeatureUnavailableError";
    this.status = 402;
    this.cta = cta;
  }
}

export class UserInactiveError extends Error {
  status: number;

  constructor(message = "Usuário inativo. Entre em contato com o suporte.") {
    super(message);
    this.name = "UserInactiveError";
    this.status = 403;
  }
}

async function getUsageCount(userId: string, eventType: UsageEventType, periodStart: string, periodEnd: string) {
  const events = await supabaseAdminRequest<UsageEventRow[]>(
    `/rest/v1/usage_events?user_id=eq.${encodeURIComponent(userId)}&event_type=eq.${encodeURIComponent(eventType)}&period_start=eq.${encodeURIComponent(periodStart)}&period_end=eq.${encodeURIComponent(periodEnd)}&select=count`,
    { method: "GET" }
  );

  return events.reduce((total, event) => total + (event.count ?? 0), 0);
}

function assertActiveProfile(access: ResolvedAccess) {
  if (!access.profileActive) {
    throw new UserInactiveError();
  }
}

export async function getPlanLimitCheck(
  userId: string,
  eventType: UsageEventType,
  incrementBy = 1,
  preloadedAccess?: ResolvedAccess
): Promise<PlanLimitCheckResult> {
  const normalizedIncrement = Math.max(1, Math.floor(incrementBy));
  const access = preloadedAccess ?? (await resolveUserAccess(userId));

  assertActiveProfile(access);

  const { periodStart, periodEnd } = getCurrentMonthlyPeriod();
  const limit = access.unlimitedAccess ? null : resolveLimit(eventType, access.entitlements);
  const used = await getUsageCount(userId, eventType, periodStart, periodEnd);
  const allowed = limit === null || used + normalizedIncrement <= limit;
  const planLabel = access.planName;
  const explanation = allowed ? null : buildLimitMessage(eventType, planLabel, limit, used);

  return {
    allowed,
    userId,
    planSlug: access.planCode,
    planLabel,
    eventType,
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart,
    periodEnd,
    unlimitedAccess: access.unlimitedAccess,
    message: explanation?.message,
    cta: explanation?.cta ?? null
  };
}

export async function assertPlanLimit(
  userId: string,
  eventType: UsageEventType,
  incrementBy = 1,
  preloadedAccess?: ResolvedAccess
) {
  const result = await getPlanLimitCheck(userId, eventType, incrementBy, preloadedAccess);

  if (!result.allowed) {
    throw new PlanLimitExceededError(result);
  }

  return result;
}

export async function recordUsageEvent(userId: string, eventType: UsageEventType, count = 1) {
  const normalizedCount = Math.max(1, Math.floor(count));
  const { periodStart, periodEnd } = getCurrentMonthlyPeriod();

  await supabaseAdminRequest("/rest/v1/usage_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      event_type: eventType,
      count: normalizedCount,
      period_start: periodStart,
      period_end: periodEnd
    })
  });
}

export async function getQuestionHistory(userId: string, source?: QuestionHistorySource, limit = 25) {
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const sourceFilter = source ? `&source=eq.${encodeURIComponent(source)}` : "";

  return supabaseAdminRequest<QuestionHistoryEntry[]>(
    `/rest/v1/ai_question_history?user_id=eq.${encodeURIComponent(userId)}${sourceFilter}&select=id,case_id,source,question,answer,created_at&order=created_at.desc&limit=${normalizedLimit}`,
    { method: "GET" }
  );
}

export async function recordQuestionHistory(input: QuestionHistoryInput) {
  const question = input.question.trim();

  if (question.length < 3) {
    return;
  }

  await supabaseAdminRequest("/rest/v1/ai_question_history", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: input.userId,
      case_id: input.caseId ?? null,
      source: input.source ?? "qa",
      question,
      answer: input.answer ?? null
    })
  });
}

export async function checkAndRecordUsageEvent(userId: string, eventType: UsageEventType, count = 1) {
  const result = await assertPlanLimit(userId, eventType, count);
  await recordUsageEvent(userId, eventType, count);
  return result;
}

const FEATURE_ENTITLEMENT: Record<PlanFeature, (entitlements: Entitlements) => boolean> = {
  photo_upload: (entitlements) => entitlements.AI_IMAGES,
  soil_analysis_upload: (entitlements) => entitlements.SOIL_ANALYSIS_UPLOAD,
  // Histórico simples permanece disponível em todos os planos.
  simple_history: () => true
};

const FEATURE_MESSAGES: Record<PlanFeature, string> = {
  photo_upload: "inclui análise e interpretacao de fotos",
  soil_analysis_upload: "inclui upload de análise de solo",
  simple_history: "inclui histórico das consultas"
};

export async function assertPlanFeature(userId: string, feature: PlanFeature, preloadedAccess?: ResolvedAccess) {
  const access = preloadedAccess ?? (await resolveUserAccess(userId));

  assertActiveProfile(access);

  if (access.unlimitedAccess) {
    return { userId, planSlug: access.planCode, planLabel: "Acesso ilimitado", feature, unlimitedAccess: true };
  }

  if (!FEATURE_ENTITLEMENT[feature](access.entitlements)) {
    throw new PlanFeatureUnavailableError(
      `Seu plano ${access.planName} não ${FEATURE_MESSAGES[feature]}.`,
      UPGRADE_CTA
    );
  }

  return { userId, planSlug: access.planCode, planLabel: access.planName, feature, unlimitedAccess: false };
}

export { resolveUserAccess };
export type { ResolvedAccess };

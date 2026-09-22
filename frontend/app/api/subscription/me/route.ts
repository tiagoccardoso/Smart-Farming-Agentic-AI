/**
 * Dados da area "Minha assinatura": plano atual, valor, situacao, proxima
 * cobranca, consultas a IA e pareceres utilizados/restantes.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../../lib/billing/entitlements";
import { describeSubscriptionState } from "../../../../lib/billing/subscription-state";
import { getPlanLimitCheck } from "../../../../lib/billing/check-plan-limits";
import { getTechnicalOpinionBalance } from "../../../../lib/billing/technical-opinions";
import { errorMessage, errorStatus, requireUser } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);
    const [aiUsage, opinions] = await Promise.all([
      getPlanLimitCheck(user.id, "ai_question", 1, access).catch(() => null),
      getTechnicalOpinionBalance(access).catch(() => null)
    ]);

    const subscription = access.subscription;

    return NextResponse.json({
      plan: {
        code: access.planCode,
        name: access.planName,
        priceCents: subscription?.priceCents ?? null,
        legacyPlanCode: access.legacyPlanCode,
        unlimitedAccess: access.unlimitedAccess
      },
      entitlements: access.entitlements,
      subscription: subscription
        ? {
            state: subscription.state,
            stateLabel: describeSubscriptionState(subscription.state),
            entitled: subscription.entitled,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            nextChargeAt: subscription.cancelAtPeriodEnd ? null : subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            hasStripeCustomer: Boolean(subscription.stripeCustomerId)
          }
        : null,
      aiUsage: aiUsage
        ? {
            limit: aiUsage.limit,
            used: aiUsage.used,
            remaining: aiUsage.remaining,
            periodStart: aiUsage.periodStart,
            periodEnd: aiUsage.periodEnd
          }
        : null,
      technicalOpinions: opinions
        ? {
            limit: access.unlimitedAccess ? null : opinions.limit,
            used: opinions.used,
            remaining: access.unlimitedAccess ? null : opinions.remaining,
            availableCredits: opinions.availableCredits,
            usageLabel: opinions.usageLabel,
            remainingLabel: opinions.remainingLabel,
            cycleEnd: opinions.cycle.end
          }
        : null
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel carregar sua assinatura.") },
      { status: errorStatus(error) }
    );
  }
}

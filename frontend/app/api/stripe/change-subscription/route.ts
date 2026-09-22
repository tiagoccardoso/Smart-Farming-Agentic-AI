/**
 * Upgrade e downgrade entre planos pagos.
 *
 * Regra de proration adotada: `create_prorations` (padrao do Stripe). O valor
 * não utilizado do plano atual vira crédito e a diferenca proporcional do novo
 * plano entra na próxima fatura. A regra é exibida ao usuário antes da troca.
 *
 * O estado final da assinatura NAO e gravado aqui: quem grava e o webhook
 * `customer.subscription.updated`.
 */

import { NextRequest, NextResponse } from "next/server";
import { isSubscribablePlanCode, resolveUserAccess } from "../../../../lib/billing/entitlements";
import { fetchPaidPlan, updateSubscriptionPlan } from "../../../../lib/stripe/subscription";
import { errorMessage, errorStatus, requireUser } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

const PRORATION_NOTICE =
  "A troca usa cobrança proporcional (proration): o Stripe credita o período não utilizado do plano atual e cobra a diferenca do novo plano na próxima fatura.";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const payload = (await request.json().catch(() => null)) as { planSlug?: string } | null;
    const planSlug = payload?.planSlug?.trim();

    if (!isSubscribablePlanCode(planSlug)) {
      return NextResponse.json({ error: "Informe um plano mensal válido." }, { status: 400 });
    }

    const access = await resolveUserAccess(user.id);

    if (!access.profileActive) {
      return NextResponse.json({ error: "Usuário inativo. Entre em contato com o suporte." }, { status: 403 });
    }

    const subscription = access.subscription;

    if (!subscription?.entitled || !subscription.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "Não ha assinatura ativa para trocar. Assine um plano para continuar.", requiresCheckout: true },
        { status: 409 }
      );
    }

    if (access.planCode === planSlug) {
      return NextResponse.json({ error: `Você já esta no plano ${access.planName}.` }, { status: 409 });
    }

    const plan = await fetchPaidPlan(planSlug);

    const updated = await updateSubscriptionPlan({
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      plan,
      userId: user.id
    });

    return NextResponse.json({
      updated: true,
      planSlug: plan.slug,
      planName: plan.name,
      stripeStatus: updated.status ?? null,
      prorationBehavior: "create_prorations",
      notice: PRORATION_NOTICE,
      message: `Troca solicitada para ${plan.name}. A confirmação aparece assim que o Stripe processar a alteração.`
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível trocar de plano.") },
      { status: errorStatus(error) }
    );
  }
}

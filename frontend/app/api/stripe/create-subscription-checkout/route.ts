/**
 * Inicia a assinatura de um plano pago (Checkout Session, modo subscription).
 *
 * O plano só é liberado quando o webhook confirma o pagamento. Aqui apenas
 * registramos a intencao (`checkout_pending`) e devolvemos a URL do Stripe.
 */

import { NextRequest, NextResponse } from "next/server";
import { isSubscribablePlanCode, resolveUserAccess } from "../../../../lib/billing/entitlements";
import {
  createSubscriptionCheckoutSession,
  fetchPaidPlan,
  resolveStripeCustomerId,
  upsertSubscriptionRecord
} from "../../../../lib/stripe/subscription";
import { errorMessage, errorStatus, requireUser } from "../../../../lib/server/request-auth";

type CreateSubscriptionCheckoutPayload = {
  planSlug?: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const payload = (await request.json().catch(() => null)) as CreateSubscriptionCheckoutPayload | null;
    const planSlug = payload?.planSlug?.trim();

    if (!isSubscribablePlanCode(planSlug)) {
      return NextResponse.json({ error: "Informe um plano mensal válido para assinatura." }, { status: 400 });
    }

    const [access, plan] = await Promise.all([resolveUserAccess(user.id), fetchPaidPlan(planSlug)]);

    if (!access.profileActive) {
      return NextResponse.json({ error: "Usuário inativo. Entre em contato com o suporte." }, { status: 403 });
    }

    if (access.planCode === planSlug && access.subscription?.entitled) {
      return NextResponse.json(
        { error: `Você já possui o plano ${access.planName} ativo.`, alreadySubscribed: true },
        { status: 409 }
      );
    }

    // Já existe assinatura ativa em outro plano: a troca é feita por
    // upgrade/downgrade na assinatura atual, não por uma segunda cobrança.
    if (access.subscription?.entitled && access.subscription.stripeSubscriptionId) {
      return NextResponse.json(
        {
          error: "Você já possui uma assinatura ativa. Use a troca de plano para migrar sem cobrança duplicada.",
          requiresPlanChange: true,
          currentPlanCode: access.planCode,
          targetPlanCode: planSlug
        },
        { status: 409 }
      );
    }

    const stripeCustomerId = await resolveStripeCustomerId(user.id, user.email);
    const stripeSession = await createSubscriptionCheckoutSession(request, plan, user.id, stripeCustomerId);

    await upsertSubscriptionRecord({
      userId: user.id,
      planId: plan.id,
      stripeCustomerId,
      stripePriceId: plan.stripe_price_id ?? null,
      status: "checkout_pending",
      internalStatus: "payment_pending"
    });

    return NextResponse.json({
      checkoutUrl: stripeSession.url,
      checkoutSessionId: stripeSession.id,
      planSlug: plan.slug,
      planId: plan.id,
      stripeCustomerId
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível criar o checkout de assinatura.") },
      { status: errorStatus(error) }
    );
  }
}

/**
 * Abre o Stripe Customer Portal para o assinante gerenciar cartao, faturas,
 * troca de plano e cancelamento. Nenhum dado de pagamento passa pela PlantaSa.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../../lib/billing/entitlements";
import { createBillingPortalSession, findReusableStripeCustomerId } from "../../../../lib/stripe/subscription";
import { errorMessage, errorStatus, requireUser } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);
    const stripeCustomerId = access.subscription?.stripeCustomerId || (await findReusableStripeCustomerId(user.id));

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: "Voce ainda nao possui assinatura no Stripe. Assine um plano para gerenciar a cobranca." },
        { status: 409 }
      );
    }

    const session = await createBillingPortalSession(request, stripeCustomerId);

    return NextResponse.json({ portalUrl: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel abrir o portal de cobranca.") },
      { status: errorStatus(error) }
    );
  }
}

/**
 * Rota do antigo checkout avulso — DESCONTINUADA.
 *
 * O parecer agronômico humano passou a ser benefício mensal dos planos
 * elegíveis (ver lib/billing/human-opinions.ts). Esta rota não cria mais
 * pedidos nem sessões de checkout no Stripe; responde 410 com orientação.
 * O webhook continua processando sessões antigas já pagas (histórico).
 */

import { legacyOneTimeCheckoutGone } from "../../../../lib/server/legacy-one-time-checkout";

export const dynamic = "force-dynamic";

export async function POST() {
  return legacyOneTimeCheckoutGone();
}

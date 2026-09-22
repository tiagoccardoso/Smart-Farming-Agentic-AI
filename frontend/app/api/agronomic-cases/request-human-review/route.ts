/**
 * Solicita parecer agronômico humano para um caso existente.
 *
 * Antes: criava pedido avulso pendente e levava ao checkout Stripe (R$ 197).
 * Agora: consome 1 parecer do benefício mensal do plano (IA Profissional = 1,
 * Consultoria Agronômica = 3), validado no servidor. Sem cobrança avulsa.
 */

import { NextRequest } from "next/server";
import { handleCaseHumanOpinionRequest } from "../../../../lib/server/human-opinion-request";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { caseId?: unknown } | null;
  return handleCaseHumanOpinionRequest(request, body?.caseId);
}

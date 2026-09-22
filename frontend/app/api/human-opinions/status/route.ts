/**
 * Saldo de pareceres agronômicos humanos do usuário autenticado.
 *
 * Tudo é resolvido no servidor (assinatura, estado, plano, limite, ciclo e
 * consumo). Nada vindo do navegador influencia o resultado.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../../lib/billing/entitlements";
import { getHumanOpinionStatus, toPublicHumanOpinionStatus } from "../../../../lib/billing/human-opinions";
import { UnauthenticatedError, requireUser } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);
    const status = await getHumanOpinionStatus(access);

    return NextResponse.json({ humanOpinion: toPublicHumanOpinionStatus(status) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: NO_STORE });
    }

    console.error("[human-opinion] falha ao calcular saldo", {
      message: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      { error: "Não foi possível verificar seus pareceres agora. Tente novamente em instantes." },
      { status: 500, headers: NO_STORE }
    );
  }
}

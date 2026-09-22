/**
 * Demandas técnicas (pareceres).
 *
 * GET  -> lista os pareceres do usuário e o saldo do ciclo (calculado no servidor).
 * POST -> encerrado: o parecer é solicitado pelo envio de caso (/enviar-caso).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../lib/billing/entitlements";
import { getHumanOpinionStatus, toPublicHumanOpinionStatus } from "../../../lib/billing/human-opinions";
import { getTechnicalOpinionBalance, listTechnicalOpinions } from "../../../lib/billing/technical-opinions";
import { errorMessage, errorStatus, requireUser } from "../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);
    const [opinions, balance, humanOpinion] = await Promise.all([
      listTechnicalOpinions(user.id),
      getTechnicalOpinionBalance(access),
      getHumanOpinionStatus(access)
    ]);

    return NextResponse.json({
      opinions,
      balance: {
        limit: access.unlimitedAccess ? null : balance.limit,
        used: balance.used,
        remaining: access.unlimitedAccess ? null : balance.remaining,
        availableCredits: balance.availableCredits,
        canOpen: balance.canOpen,
        usageLabel: balance.usageLabel,
        remainingLabel: balance.remainingLabel,
        cycleEnd: balance.cycle.end
      },
      humanOpinion: toPublicHumanOpinionStatus(humanOpinion),
      plan: { code: access.planCode, name: access.planName }
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível carregar seus pareceres técnicos.") },
      { status: errorStatus(error) }
    );
  }
}

/**
 * Abertura de demanda avulsa (sem caso) encerrada.
 *
 * O parecer agronômico humano é solicitado exclusivamente pelo envio de caso
 * (/enviar-caso ou "Solicitar parecer" em um caso existente), que coloca o caso
 * na fila da especialista e consome o benefício do plano de forma atômica.
 * Assim nenhum parecer é consumido em uma demanda que a especialista não recebe.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Faça login para continuar.") }, { status: errorStatus(error, 401) });
  }

  return NextResponse.json(
    {
      error: "Para solicitar um parecer agronômico humano, envie o seu caso com fotos e informações da lavoura.",
      code: "USE_CASE_SUBMISSION",
      redirectTo: "/enviar-caso",
      options: [{ label: "Enviar caso", href: "/enviar-caso" }]
    },
    { status: 410 }
  );
}

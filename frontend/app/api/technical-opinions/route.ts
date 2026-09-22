/**
 * Demandas tecnicas (pareceres).
 *
 * GET  -> lista as demandas do usuario e o saldo do ciclo.
 * POST -> abre uma nova demanda. A validacao do direito acontece AQUI, no
 *         servidor: mesmo que o botao esteja escondido na interface, a API
 *         verifica se o usuario tem Consultoria Agronomica ativa ou um credito
 *         avulso valido antes de criar qualquer coisa.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "../../../lib/billing/entitlements";
import {
  TechnicalOpinionLimitError,
  createTechnicalOpinion,
  getTechnicalOpinionBalance,
  listTechnicalOpinions
} from "../../../lib/billing/technical-opinions";
import { supabaseAdminRequest } from "../../../lib/server/supabaseAdmin";
import { errorMessage, errorStatus, requireUser } from "../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

const CONSULTING_CTA = { label: "Quero Consultoria Agronomica", href: "/planos" };
const ONE_TIME_CTA = { label: "Solicitar parecer avulso", href: "/planos#parecer-avulso" };

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const access = await resolveUserAccess(user.id);
    const [opinions, balance] = await Promise.all([
      listTechnicalOpinions(user.id),
      getTechnicalOpinionBalance(access)
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
      plan: { code: access.planCode, name: access.planName }
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel carregar seus pareceres tecnicos.") },
      { status: errorStatus(error) }
    );
  }
}

async function assertPropertyBelongsToUser(propertyId: string, userId: string) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(propertyId)}&owner_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
    { method: "GET" }
  );

  return Boolean(rows[0]);
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const payload = (await request.json().catch(() => null)) as {
      title?: string;
      description?: string;
      propertyId?: string | null;
      caseId?: string | null;
    } | null;

    const title = payload?.title?.trim() ?? "";
    const description = payload?.description?.trim() ?? "";

    if (title.length < 3 || title.length > 200) {
      return NextResponse.json({ error: "Informe um titulo entre 3 e 200 caracteres para a demanda." }, { status: 400 });
    }

    if (description.length < 10) {
      return NextResponse.json(
        { error: "Descreva a demanda com pelo menos 10 caracteres para o especialista entender o problema." },
        { status: 400 }
      );
    }

    const access = await resolveUserAccess(user.id);

    if (!access.profileActive) {
      return NextResponse.json({ error: "Usuario inativo. Entre em contato com o suporte." }, { status: 403 });
    }

    if (payload?.propertyId && !(await assertPropertyBelongsToUser(payload.propertyId, user.id))) {
      return NextResponse.json({ error: "A propriedade informada nao pertence a este usuario." }, { status: 403 });
    }

    const opinion = await createTechnicalOpinion({
      access,
      title,
      description,
      propertyId: payload?.propertyId ?? null,
      caseId: payload?.caseId ?? null
    });

    const balance = await getTechnicalOpinionBalance(access);

    return NextResponse.json(
      {
        opinion,
        message:
          opinion.origin === "one_time"
            ? "Demanda aberta com o seu parecer tecnico avulso."
            : "Demanda aberta. As mensagens, fotos e documentos desta demanda nao consomem novos pareceres.",
        balance: {
          limit: access.unlimitedAccess ? null : balance.limit,
          used: balance.used,
          remaining: access.unlimitedAccess ? null : balance.remaining,
          availableCredits: balance.availableCredits,
          usageLabel: balance.usageLabel,
          remainingLabel: balance.remainingLabel
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TechnicalOpinionLimitError) {
      const limitReached = Boolean(error.balance && error.balance.limit > 0);

      return NextResponse.json(
        {
          error: error.message,
          reason: limitReached ? "cycle_limit_reached" : "plan_without_technical_opinions",
          balance: error.balance
            ? {
                limit: error.balance.limit,
                used: error.balance.used,
                remaining: error.balance.remaining,
                availableCredits: error.balance.availableCredits,
                cycleEnd: error.balance.cycle.end
              }
            : null,
          options: limitReached
            ? [
                { label: "Aguardar o proximo ciclo", href: "/minha-assinatura" },
                ONE_TIME_CTA
              ]
            : [CONSULTING_CTA, ONE_TIME_CTA]
        },
        { status: 402 }
      );
    }

    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel abrir a demanda tecnica.") },
      { status: errorStatus(error) }
    );
  }
}

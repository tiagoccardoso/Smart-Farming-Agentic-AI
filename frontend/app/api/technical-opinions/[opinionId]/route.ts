/**
 * Detalhe de uma demanda tecnica. O dono ve a propria demanda; especialistas e
 * administradores veem qualquer uma e podem alterar o status.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TechnicalOpinionStatus,
  getTechnicalOpinion,
  isTechnicalOpinionStatus,
  listTechnicalOpinionMessages,
  updateTechnicalOpinionStatus
} from "../../../../lib/billing/technical-opinions";
import { errorMessage, errorStatus, requireProfile } from "../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: { opinionId: string } };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { user, profile } = await requireProfile(request);
    const opinion = await getTechnicalOpinion(params.opinionId);
    const isStaff = profile.role === "admin" || profile.role === "specialist";

    if (!opinion || (opinion.user_id !== user.id && !isStaff)) {
      return NextResponse.json({ error: "Demanda tecnica nao encontrada." }, { status: 404 });
    }

    const messages = await listTechnicalOpinionMessages(opinion.id);

    return NextResponse.json({ opinion, messages });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel carregar a demanda tecnica.") },
      { status: errorStatus(error) }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { user, profile } = await requireProfile(request);
    const opinion = await getTechnicalOpinion(params.opinionId);

    if (!opinion) {
      return NextResponse.json({ error: "Demanda tecnica nao encontrada." }, { status: 404 });
    }

    const payload = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = payload?.status;

    if (!isTechnicalOpinionStatus(status)) {
      return NextResponse.json({ error: "Informe um status valido para a demanda." }, { status: 400 });
    }

    const isStaff = profile.role === "admin" || profile.role === "specialist";
    const clientAllowed: TechnicalOpinionStatus[] = ["concluido", "cancelado"];

    if (!isStaff) {
      if (opinion.user_id !== user.id) {
        return NextResponse.json({ error: "Demanda tecnica nao encontrada." }, { status: 404 });
      }

      if (!clientAllowed.includes(status)) {
        return NextResponse.json(
          { error: "Somente o especialista pode alterar a demanda para este status." },
          { status: 403 }
        );
      }

      // Cancelar uma demanda ja atendida devolveria um parecer indevidamente.
      if (status === "cancelado" && opinion.status !== "aberto") {
        return NextResponse.json(
          { error: "Esta demanda ja entrou em analise e nao pode mais ser cancelada." },
          { status: 409 }
        );
      }
    }

    await updateTechnicalOpinionStatus(opinion.id, status);

    return NextResponse.json({ updated: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel atualizar a demanda tecnica.") },
      { status: errorStatus(error) }
    );
  }
}

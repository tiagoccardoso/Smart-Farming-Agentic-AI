/**
 * Detalhe de uma demanda técnica. O dono ve a própria demanda; especialistas e
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
      return NextResponse.json({ error: "Demanda técnica não encontrada." }, { status: 404 });
    }

    const messages = await listTechnicalOpinionMessages(opinion.id);

    return NextResponse.json({ opinion, messages });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível carregar a demanda técnica.") },
      { status: errorStatus(error) }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { user, profile } = await requireProfile(request);
    const opinion = await getTechnicalOpinion(params.opinionId);

    if (!opinion) {
      return NextResponse.json({ error: "Demanda técnica não encontrada." }, { status: 404 });
    }

    const payload = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = payload?.status;

    if (!isTechnicalOpinionStatus(status)) {
      return NextResponse.json({ error: "Informe um status válido para a demanda." }, { status: 400 });
    }

    const isStaff = profile.role === "admin" || profile.role === "specialist";
    const clientAllowed: TechnicalOpinionStatus[] = ["concluido", "cancelado"];

    if (!isStaff) {
      if (opinion.user_id !== user.id) {
        return NextResponse.json({ error: "Demanda técnica não encontrada." }, { status: 404 });
      }

      if (!clientAllowed.includes(status)) {
        return NextResponse.json(
          { error: "Somente o especialista pode alterar a demanda para este status." },
          { status: 403 }
        );
      }

      // Parecer vinculado a caso: o caso já está na fila da especialista.
      // Cancelar aqui devolveria a franquia sem retirar o caso da fila.
      if (status === "cancelado" && opinion.case_id) {
        return NextResponse.json(
          { error: "Este parecer está vinculado a um caso enviado à especialista e não pode ser cancelado por aqui." },
          { status: 409 }
        );
      }

      // Cancelar uma demanda já atendida devolveria um parecer indevidamente.
      if (status === "cancelado" && opinion.status !== "aberto") {
        return NextResponse.json(
          { error: "Esta demanda já entrou em análise e não pode mais ser cancelada." },
          { status: 409 }
        );
      }
    }

    await updateTechnicalOpinionStatus(opinion.id, status);

    return NextResponse.json({ updated: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível atualizar a demanda técnica.") },
      { status: errorStatus(error) }
    );
  }
}

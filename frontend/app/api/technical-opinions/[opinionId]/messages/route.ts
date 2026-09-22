/**
 * Mensagens de uma demanda técnica.
 *
 * IMPORTANTE: mensagens, perguntas complementares, fotos, documentos e
 * resultados de análise vinculados a MESMA demanda não consomem novo parecer.
 * O parecer foi consumido na criação da demanda.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  addTechnicalOpinionMessage,
  getTechnicalOpinion,
  listTechnicalOpinionMessages
} from "../../../../../lib/billing/technical-opinions";
import { errorMessage, errorStatus, requireProfile } from "../../../../../lib/server/request-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: { opinionId: string } };

const CLOSED_STATUSES = new Set(["concluido", "cancelado"]);

function normalizeAttachments(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 2000)
    .slice(0, 20);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { user, profile } = await requireProfile(request);
    const opinion = await getTechnicalOpinion(params.opinionId);
    const isStaff = profile.role === "admin" || profile.role === "specialist";

    if (!opinion || (opinion.user_id !== user.id && !isStaff)) {
      return NextResponse.json({ error: "Demanda técnica não encontrada." }, { status: 404 });
    }

    if (CLOSED_STATUSES.has(opinion.status)) {
      return NextResponse.json(
        { error: "Esta demanda já foi encerrada. Abra uma nova demanda para um novo problema." },
        { status: 409 }
      );
    }

    const payload = (await request.json().catch(() => null)) as { body?: string; attachments?: unknown } | null;
    const body = payload?.body?.trim() ?? "";

    if (body.length < 1 || body.length > 8000) {
      return NextResponse.json({ error: "Escreva uma mensagem com até 8000 caracteres." }, { status: 400 });
    }

    const message = await addTechnicalOpinionMessage({
      opinionId: opinion.id,
      authorId: user.id,
      authorRole: isStaff ? (profile.role === "admin" ? "admin" : "specialist") : "client",
      body,
      attachments: normalizeAttachments(payload?.attachments)
    });

    const messages = await listTechnicalOpinionMessages(opinion.id);

    return NextResponse.json({
      message,
      messages,
      notice: "Mensagens desta demanda não consomem pareceres adicionais."
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível registrar a mensagem.") },
      { status: errorStatus(error) }
    );
  }
}

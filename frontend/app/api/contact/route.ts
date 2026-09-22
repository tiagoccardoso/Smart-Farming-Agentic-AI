/**
 * Formulario de Contato (/contact).
 *
 * Registra a solicitacao em `specialist_visit_requests` (source = 'agendamento',
 * acompanhada em /admin/agendamentos), com anexos opcionais (imagens e audio)
 * em bucket privado. Mesmo fluxo da Solicitacao de Orcamento:
 * lib/server/public-requests/submit.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_REQUEST_SOURCES, isValidSubmissionKey } from "../../../lib/public-requests/config";
import { isContactRequestType, isContactVisitType } from "../../../lib/public-requests/contact";
import { validateAttachments } from "../../../lib/server/public-requests/attachments";
import { readPublicRequestBody } from "../../../lib/server/public-requests/request-body";
import { persistPublicRequest } from "../../../lib/server/public-requests/submit";
import { publicErrorResponse } from "../../../lib/server/public-requests/errors";

export const dynamic = "force-dynamic";

const SUCCESS_MESSAGE = "Recebemos sua solicitação. A especialista entrará em contato para confirmar as informações.";

function field(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await readPublicRequestBody(request);
    const fields = body.fields;

    // Honeypot: campo invisivel para pessoas; bots costumam preenche-lo.
    if (field(fields.website, 200)) {
      return NextResponse.json({ message: SUCCESS_MESSAGE });
    }

    const name = field(fields.name, 200);
    const email = field(fields.email, 200);
    const phone = field(fields.phone, 40);
    const city = field(fields.city, 120);
    const state = field(fields.state, 60).toUpperCase();
    const preferredDate = field(fields.preferredDate, 10);
    const preferredTime = field(fields.preferredTime, 40);
    const requestType = field(fields.requestType, 60);
    const message = field(fields.message, 4000);
    const rawKey = field(fields.submissionKey, 100) || field(request.headers.get("Idempotency-Key"), 100);
    const submissionKey = isValidSubmissionKey(rawKey) ? rawKey : null;

    if (name.length < 2) return badRequest("Informe seu nome.");
    if (!isContactRequestType(requestType)) return badRequest("Selecione o tipo de solicitação.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest("Informe um e-mail válido.");
    if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return badRequest("Informe uma data válida.");

    if (isContactVisitType(requestType) && (!phone || !city || !state || !preferredDate || !preferredTime)) {
      return badRequest("Telefone, cidade, estado, dia e horário são obrigatórios para agendamento de visita.");
    }

    const attachments = await validateAttachments({
      images: body.images,
      audios: body.audios,
      audioDurationSeconds: fields.audioDuration
    });

    await persistPublicRequest({
      headers: request.headers,
      source: PUBLIC_REQUEST_SOURCES.contact,
      submissionKey,
      attachments,
      record: {
        name,
        email: email || null,
        phone: phone || null,
        city: city || null,
        state: state || null,
        preferred_date: preferredDate || null,
        preferred_time: preferredTime || null,
        request_type: requestType,
        message: message || null
      }
    });

    return NextResponse.json({ message: SUCCESS_MESSAGE });
  } catch (error) {
    return publicErrorResponse(error, "Não foi possível enviar sua solicitação agora. Tente novamente em instantes.", "contact");
  }
}

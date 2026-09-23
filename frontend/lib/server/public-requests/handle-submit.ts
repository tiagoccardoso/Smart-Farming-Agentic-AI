/**
 * Envio unico dos formularios publicos de Contato (/api/contact) e
 * Solicitacao de Orcamento (/api/service-quotes).
 *
 * As duas rotas usam exatamente o mesmo fluxo: honeypot -> validacao
 * (lib/public-requests/form.ts, a mesma do navegador) -> propriedade do
 * usuario -> anexos -> persistencia idempotente (submit.ts). A unica
 * diferenca e a origem gravada em `source`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../auth";
import { PUBLIC_REQUEST_SOURCES, isValidSubmissionKey } from "../../public-requests/config";
import {
  PUBLIC_REQUEST_ERROR_MESSAGE,
  PUBLIC_REQUEST_SUCCESS_MESSAGE,
  utcIsoDateOffset,
  validatePublicRequestForm,
  type PublicRequestOrigin
} from "../../public-requests/form";
import { QUOTE_REQUEST_TYPE } from "../../service-quotes";
import { getRequestToken } from "../request-auth";
import { supabaseAdminRequest } from "../supabaseAdmin";
import { validateAttachments } from "./attachments";
import { publicErrorResponse } from "./errors";
import { readPublicRequestBody } from "./request-body";
import { persistPublicRequest } from "./submit";

function optionalText(value: unknown, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

async function isOwnProperty(propertyId: string, userId: string) {
  const owned = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(propertyId)}&owner_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
    { method: "GET" }
  );
  return Boolean(owned[0]);
}

export async function handlePublicRequestSubmit(request: NextRequest, origin: PublicRequestOrigin) {
  try {
    const token = getRequestToken(request);
    const user = token ? await getCurrentUser(token).catch(() => null) : null;
    const body = await readPublicRequestBody(request);
    const fields = body.fields;

    // Honeypot: campo invisivel para pessoas; bots costumam preenche-lo.
    if (optionalText(fields.website, 200)) {
      return NextResponse.json({ requestId: null, message: PUBLIC_REQUEST_SUCCESS_MESSAGE }, { status: 201 });
    }

    const validation = validatePublicRequestForm(
      {
        ...fields,
        // Compatibilidade com clientes antigos do formulario de orcamento.
        requestType: fields.requestType ?? fields.serviceType,
        message: fields.message ?? fields.description
      },
      { hasAudio: body.audios.length > 0, minDate: utcIsoDateOffset(-1) }
    );

    if (!validation.ok) {
      return NextResponse.json({ error: validation.message, field: validation.field }, { status: 400 });
    }

    const data = validation.value;

    // Uma propriedade so pode ser vinculada pelo proprio dono (e somente autenticado).
    let propertyId: string | null = null;
    if (data.propertyId && user?.id) {
      if (!(await isOwnProperty(data.propertyId, user.id))) {
        return NextResponse.json({ error: "A propriedade informada não pertence a este usuário.", field: "propertyId" }, { status: 403 });
      }
      propertyId = data.propertyId;
    }

    const attachments = await validateAttachments({
      images: body.images,
      audios: body.audios,
      audioDurationSeconds: fields.audioDuration
    });

    const rawKey = optionalText(fields.submissionKey, 100) ?? optionalText(request.headers.get("Idempotency-Key"), 100);

    const result = await persistPublicRequest({
      headers: request.headers,
      source: PUBLIC_REQUEST_SOURCES[origin],
      submissionKey: isValidSubmissionKey(rawKey) ? rawKey : null,
      attachments,
      record: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        city: data.city,
        state: data.state,
        preferred_date: data.preferredDate,
        preferred_time: data.preferredTime,
        // request_type mantem os valores historicos de cada origem; o tipo
        // escolhido fica em service_type nas duas.
        request_type: origin === "quote" ? QUOTE_REQUEST_TYPE : data.requestType,
        service_type: data.requestType,
        message: data.message,
        // Campo "Observacoes" saiu do formulario (redundante com a descricao);
        // continua aceito de clientes antigos.
        notes: optionalText(fields.notes, 4000),
        property_id: propertyId,
        user_id: user?.id ?? null,
        status: "novo"
      }
    });

    return NextResponse.json({ requestId: result.requestId, message: PUBLIC_REQUEST_SUCCESS_MESSAGE }, { status: 201 });
  } catch (error) {
    return publicErrorResponse(error, PUBLIC_REQUEST_ERROR_MESSAGE, origin === "quote" ? "service-quotes" : "contact");
  }
}

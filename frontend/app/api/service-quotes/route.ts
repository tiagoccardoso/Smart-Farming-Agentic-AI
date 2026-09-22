/**
 * Solicitação de orçamento — Presencial & Projetos Especiais.
 *
 * Categoria "sob consulta": nenhuma assinatura nem preço fixo é criado no
 * Stripe, e nenhuma cobrança automática acontece antes da definição do
 * orçamento. A solicitação é registrada em `specialist_visit_requests`
 * (mesma tabela já acompanhada pela área administrativa), com
 * `source = 'orcamento'`, com anexos opcionais (imagens e audio) em bucket
 * privado. Mesmo fluxo do formulario de Contato: lib/server/public-requests.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminRequest } from "../../../lib/server/supabaseAdmin";
import { errorMessage, errorStatus, getRequestToken } from "../../../lib/server/request-auth";
import { getCurrentProfile, getCurrentUser } from "../../../lib/auth";
import { QUOTE_REQUEST_TYPE, QUOTE_SERVICE_LABELS, QUOTE_SOURCE, isQuoteServiceType } from "../../../lib/service-quotes";
import { isValidSubmissionKey } from "../../../lib/public-requests/config";
import { validateAttachments } from "../../../lib/server/public-requests/attachments";
import { publicErrorResponse } from "../../../lib/server/public-requests/errors";
import { readPublicRequestBody } from "../../../lib/server/public-requests/request-body";
import { persistPublicRequest } from "../../../lib/server/public-requests/submit";

export const dynamic = "force-dynamic";

const SUCCESS_MESSAGE =
  "Solicitação registrada. Nossa equipe entrará em contato para entender a necessidade e enviar o orçamento. Nenhuma cobrança é feita antes da sua aprovação.";

function requiredText(value: unknown, field: string, min: number, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (normalized.length < min) {
    throw Object.assign(new Error(`Informe ${field}.`), { status: 400 });
  }

  if (normalized.length > max) {
    throw Object.assign(new Error(`${field} excede ${max} caracteres.`), { status: 400 });
  }

  return normalized;
}

function optionalText(value: unknown, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

/** Dados já conhecidos do usuário autenticado, para pre-preencher o formulário. */
export async function GET(request: NextRequest) {
  try {
    const token = getRequestToken(request);

    if (!token) {
      return NextResponse.json({ authenticated: false, prefill: null, properties: [] });
    }

    const user = await getCurrentUser(token).catch(() => null);

    if (!user?.id) {
      return NextResponse.json({ authenticated: false, prefill: null, properties: [] });
    }

    const [profile, properties] = await Promise.all([
      getCurrentProfile(token, user.id).catch(() => null),
      supabaseAdminRequest<Array<{ id: string; name: string; location_gps: string | null }>>(
        `/rest/v1/acompanhamento_properties?owner_id=eq.${encodeURIComponent(user.id)}&select=id,name,location_gps&order=created_at.desc&limit=50`,
        { method: "GET" }
      ).catch(() => [])
    ]);

    return NextResponse.json({
      authenticated: true,
      prefill: {
        name: profile?.full_name ?? "",
        email: user.email ?? "",
        phone: profile?.phone ?? ""
      },
      properties
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível carregar seus dados.") },
      { status: errorStatus(error) }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getRequestToken(request);
    const user = token ? await getCurrentUser(token).catch(() => null) : null;
    const body = await readPublicRequestBody(request);
    const payload = body.fields;

    // Honeypot: campo invisivel para pessoas; bots costumam preenche-lo.
    if (optionalText(payload.website, 200)) {
      return NextResponse.json({ requestId: null, message: SUCCESS_MESSAGE }, { status: 201 });
    }

    const serviceType = payload.serviceType;

    if (!isQuoteServiceType(serviceType)) {
      return NextResponse.json({ error: "Selecione o tipo de serviço desejado." }, { status: 400 });
    }

    const propertyId = optionalText(payload.propertyId, 80);

    // Uma propriedade so pode ser vinculada pelo próprio dono.
    if (propertyId && user?.id) {
      const owned = await supabaseAdminRequest<Array<{ id: string }>>(
        `/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(propertyId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,
        { method: "GET" }
      );

      if (!owned[0]) {
        return NextResponse.json({ error: "A propriedade informada não pertence a este usuário." }, { status: 403 });
      }
    }

    const hasAudio = body.audios.length > 0;
    const email = optionalText(payload.email, 200);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    const record = {
      name: requiredText(payload.name, "o nome do produtor ou cliente", 3, 200),
      email,
      phone: requiredText(payload.phone, "um telefone para contato", 8, 40),
      city: requiredText(payload.city, "o município", 2, 120),
      state: requiredText(payload.state, "a UF", 2, 2).toUpperCase(),
      request_type: QUOTE_REQUEST_TYPE,
      service_type: serviceType,
      // Com audio anexado, a descricao escrita passa a ser opcional.
      message: hasAudio ? optionalText(payload.description, 4000) : requiredText(payload.description, "a descrição da necessidade", 10, 4000),
      notes: optionalText(payload.notes, 4000),
      property_id: user?.id ? propertyId : null,
      user_id: user?.id ?? null,
      status: "novo"
    };

    const attachments = await validateAttachments({
      images: body.images,
      audios: body.audios,
      audioDurationSeconds: payload.audioDuration
    });

    const rawKey = optionalText(payload.submissionKey, 100) ?? optionalText(request.headers.get("Idempotency-Key"), 100);

    const result = await persistPublicRequest({
      headers: request.headers,
      source: QUOTE_SOURCE,
      submissionKey: isValidSubmissionKey(rawKey) ? rawKey : null,
      attachments,
      record
    });

    return NextResponse.json(
      {
        requestId: result.requestId,
        serviceLabel: QUOTE_SERVICE_LABELS[serviceType],
        message: SUCCESS_MESSAGE
      },
      { status: 201 }
    );
  } catch (error) {
    return publicErrorResponse(error, "Não foi possível registrar a solicitação de orçamento agora. Tente novamente em instantes.", "service-quotes");
  }
}

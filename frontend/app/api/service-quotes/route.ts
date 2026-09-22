/**
 * Solicitacao de orcamento — Presencial & Projetos Especiais.
 *
 * Categoria "sob consulta": nenhuma assinatura nem preco fixo e criado no
 * Stripe, e nenhuma cobranca automatica acontece antes da definicao do
 * orcamento. A solicitacao e registrada em `specialist_visit_requests`
 * (mesma tabela ja acompanhada pela area administrativa), com
 * `source = 'orcamento'`.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminRequest } from "../../../lib/server/supabaseAdmin";
import { errorMessage, errorStatus, getRequestToken } from "../../../lib/server/request-auth";
import { getCurrentProfile, getCurrentUser } from "../../../lib/auth";
import { QUOTE_REQUEST_TYPE, QUOTE_SERVICE_LABELS, QUOTE_SOURCE, isQuoteServiceType } from "../../../lib/service-quotes";

export const dynamic = "force-dynamic";

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

/** Dados ja conhecidos do usuario autenticado, para pre-preencher o formulario. */
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
      { error: errorMessage(error, "Nao foi possivel carregar seus dados.") },
      { status: errorStatus(error) }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getRequestToken(request);
    const user = token ? await getCurrentUser(token).catch(() => null) : null;
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!payload) {
      return NextResponse.json({ error: "Envie os dados da solicitacao." }, { status: 400 });
    }

    const serviceType = payload.serviceType;

    if (!isQuoteServiceType(serviceType)) {
      return NextResponse.json({ error: "Selecione o tipo de servico desejado." }, { status: 400 });
    }

    const propertyId = optionalText(payload.propertyId, 80);

    // Uma propriedade so pode ser vinculada pelo proprio dono.
    if (propertyId && user?.id) {
      const owned = await supabaseAdminRequest<Array<{ id: string }>>(
        `/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(propertyId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,
        { method: "GET" }
      );

      if (!owned[0]) {
        return NextResponse.json({ error: "A propriedade informada nao pertence a este usuario." }, { status: 403 });
      }
    }

    const record = {
      name: requiredText(payload.name, "o nome do produtor ou cliente", 3, 200),
      email: optionalText(payload.email, 200),
      phone: requiredText(payload.phone, "um telefone para contato", 8, 40),
      city: requiredText(payload.city, "o municipio", 2, 120),
      state: requiredText(payload.state, "a UF", 2, 2).toUpperCase(),
      request_type: QUOTE_REQUEST_TYPE,
      service_type: serviceType,
      message: requiredText(payload.description, "a descricao da necessidade", 10, 4000),
      notes: optionalText(payload.notes, 4000),
      property_id: user?.id ? propertyId : null,
      user_id: user?.id ?? null,
      source: QUOTE_SOURCE,
      status: "novo"
    };

    const rows = await supabaseAdminRequest<Array<{ id: string; created_at: string }>>(
      "/rest/v1/specialist_visit_requests?select=id,created_at",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(record)
      }
    );

    return NextResponse.json(
      {
        requestId: rows[0]?.id ?? null,
        serviceLabel: QUOTE_SERVICE_LABELS[serviceType],
        message:
          "Solicitacao registrada. Nossa equipe entrara em contato para entender a necessidade e enviar o orcamento. Nenhuma cobranca e feita antes da sua aprovacao."
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Nao foi possivel registrar a solicitacao de orcamento.") },
      { status: errorStatus(error, 500) }
    );
  }
}

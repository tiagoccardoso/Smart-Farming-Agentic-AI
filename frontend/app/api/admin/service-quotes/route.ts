/**
 * Acompanhamento administrativo das solicitações de orçamento
 * (Presencial & Projetos Especiais). Restrito a administradores e especialistas.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminRequest } from "../../../../lib/server/supabaseAdmin";
import { errorMessage, errorStatus, requireRole } from "../../../../lib/server/request-auth";
import { QUOTE_SOURCE } from "../../../../lib/service-quotes";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["novo", "em_contato", "confirmado", "cancelado", "concluido"]);

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "specialist"]);

    const rows = await supabaseAdminRequest<unknown[]>(
      `/rest/v1/specialist_visit_requests?source=eq.${encodeURIComponent(QUOTE_SOURCE)}&select=id,name,email,phone,city,state,service_type,message,notes,status,user_id,property_id,internal_notes,created_at,updated_at&order=created_at.desc&limit=200`,
      { method: "GET" }
    );

    return NextResponse.json({ requests: rows });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível carregar as solicitações.") },
      { status: errorStatus(error) }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "specialist"]);

    const payload = (await request.json().catch(() => null)) as
      | { id?: string; status?: string; internalNotes?: string }
      | null;
    const id = payload?.id?.trim();

    if (!id) {
      return NextResponse.json({ error: "Informe a solicitação." }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (payload?.status) {
      if (!ALLOWED_STATUSES.has(payload.status)) {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      }
      update.status = payload.status;
    }

    if (typeof payload?.internalNotes === "string") {
      update.internal_notes = payload.internalNotes.slice(0, 4000);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    update.updated_at = new Date().toISOString();

    await supabaseAdminRequest(`/rest/v1/specialist_visit_requests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(update)
    });

    return NextResponse.json({ updated: true });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível atualizar a solicitação.") },
      { status: errorStatus(error) }
    );
  }
}

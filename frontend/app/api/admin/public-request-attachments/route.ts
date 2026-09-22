/**
 * Anexos (imagens/audio) de uma solicitacao de Contato ou Orcamento.
 *
 * Restrito a administradores e especialistas. Os arquivos ficam em bucket
 * privado; esta rota devolve URLs assinadas de curta duracao (10 minutos),
 * geradas somente quando o anexo e aberto na area administrativa.
 */

import { NextRequest, NextResponse } from "next/server";
import type { StoredAttachment } from "../../../../lib/public-requests/config";
import { signAttachments } from "../../../../lib/server/public-requests/attachments";
import { errorMessage, errorStatus, requireRole } from "../../../../lib/server/request-auth";
import { supabaseAdminRequest } from "../../../../lib/server/supabaseAdmin";
import { requireUuid } from "../../../../lib/server/uuid";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "specialist"]);

    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!requireUuid(id)) {
      return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
    }

    const rows = await supabaseAdminRequest<Array<{ attachments: StoredAttachment[] | null }>>(
      `/rest/v1/specialist_visit_requests?id=eq.${encodeURIComponent(id)}&select=attachments&limit=1`,
      { method: "GET" }
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
    }

    const attachments = Array.isArray(rows[0].attachments) ? rows[0].attachments : [];
    const signed = await signAttachments(attachments);

    return NextResponse.json({ attachments: signed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Não foi possível carregar os anexos.") },
      { status: errorStatus(error) }
    );
  }
}

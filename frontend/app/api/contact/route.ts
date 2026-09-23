/**
 * Formulario de Contato (/contact).
 *
 * Mesmo formulario e mesmo fluxo da Solicitacao de Orcamento
 * (lib/server/public-requests/handle-submit.ts). Registra em
 * `specialist_visit_requests` com source = 'agendamento' (Contato),
 * acompanhado em /admin/agendamentos.
 */

import { NextRequest } from "next/server";
import { handlePublicRequestSubmit } from "../../../lib/server/public-requests/handle-submit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handlePublicRequestSubmit(request, "contact");
}

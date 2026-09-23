/**
 * Solicitação de orçamento — Presencial & Projetos Especiais.
 *
 * Categoria "sob consulta": nenhuma assinatura nem preço fixo é criado no
 * Stripe, e nenhuma cobrança automática acontece antes da definição do
 * orçamento.
 *
 * POST: mesmo formulário e mesmo fluxo do Contato
 * (lib/server/public-requests/handle-submit.ts); a solicitação é registrada em
 * `specialist_visit_requests` com `source = 'orcamento'`, o que gera o selo
 * "Solicitação de orçamento" na área da especialista.
 *
 * GET: dados já conhecidos do usuário autenticado, usados pelos DOIS
 * formulários para pré-preenchimento.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminRequest } from "../../../lib/server/supabaseAdmin";
import { errorMessage, errorStatus, getRequestToken } from "../../../lib/server/request-auth";
import { getCurrentProfile, getCurrentUser } from "../../../lib/auth";
import { handlePublicRequestSubmit } from "../../../lib/server/public-requests/handle-submit";

export const dynamic = "force-dynamic";

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
  return handlePublicRequestSubmit(request, "quote");
}

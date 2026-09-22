import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../../lib/agronomic/case";
import { supabaseAdminRequest } from "../../../../../lib/stripe/humanReview";
import { handleCaseHumanOpinionRequest } from "../../../../../lib/server/human-opinion-request";

type UpdatedCase = {
  id: string;
  status: string | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  updated_at: string | null;
};

class FriendlyRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/**
 * Solicita parecer agronômico humano consumindo o benefício mensal do plano.
 * O antigo fluxo de pagamento avulso (pedido pendente + checkout) foi encerrado.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  return handleCaseHumanOpinionRequest(request, params.caseId);
}

export async function DELETE(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para cancelar a revisão humana." }, { status: 401 });

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(params.caseId, token);
    if (!caseData) return NextResponse.json({ error: "Caso não encontrado." }, { status: 404 });
    if (caseData.user_id !== user.id) return NextResponse.json({ error: "Você só pode cancelar solicitações dos seus próprios casos." }, { status: 403 });
    if (caseData.human_review_status && !["pending_payment", "not_requested", "pending"].includes(caseData.human_review_status)) {
      throw new FriendlyRequestError("A revisão já foi enviada para a especialista e não pode ser cancelada por aqui.", 400);
    }

    const nextStatus = caseData.ai_summary ? "ai_analyzed" : "submitted";
    const now = new Date().toISOString();
    const updatedCase = (await supabaseRequest<UpdatedCase[]>(
      `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(params.caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,status,human_review_requested,human_review_status,updated_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ human_review_requested: false, human_review_status: "not_requested", status: nextStatus, updated_at: now }),
      },
      token,
      getSupabaseConfig(),
    ))[0];

    await supabaseAdminRequest(`/rest/v1/human_reviews?case_id=eq.${encodeURIComponent(params.caseId)}&status=eq.pending`, { method: "DELETE" }).catch(() => null);
    // Histórico financeiro preservado: pedidos antigos pendentes são marcados, nunca apagados.
    await supabaseAdminRequest(`/rest/v1/one_time_orders?case_id=eq.${encodeURIComponent(params.caseId)}&payment_status=eq.pending`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ payment_status: "canceled" }) }).catch(() => null);
    await supabaseRequest(
      "/rest/v1/case_activity_logs",
      { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: params.caseId, user_id: user.id, action: "Solicitação de revisão humana cancelada", metadata: { source: "revisao-humana" } }) },
      token,
    ).catch(() => null);

    return NextResponse.json({ success: true, case: updatedCase });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("Erro ao cancelar revisão humana.", error);
    const message = error instanceof Error ? error.message : "Não foi possível cancelar a revisão humana.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

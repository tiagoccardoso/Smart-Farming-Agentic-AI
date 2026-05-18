import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanLimitExceededError, assertPlanLimit, recordUsageEvent } from "../../../../lib/billing/check-plan-limits";
import { supabaseAdminRequest } from "../../../../lib/stripe/humanReview";

type PaidHumanReviewOrder = { id: string };

type UpdatedCase = {
  id: string;
  status: string | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  updated_at: string | null;
};

class FriendlyRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function logActivity(caseId: string, userId: string, token: string) {
  try {
    await supabaseRequest(
      "/rest/v1/case_activity_logs",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          case_id: caseId,
          user_id: userId,
          action: "Revisão humana solicitada",
          metadata: { source: "consultoria-ia" },
        }),
      },
      token,
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Não foi possível registrar atividade de revisão humana.", error);
    }
  }
}

async function hasPaidHumanReviewOrder(userId: string, caseId: string) {
  const orders = await supabaseAdminRequest<PaidHumanReviewOrder[]>(
    `/rest/v1/one_time_orders?user_id=eq.${encodeURIComponent(userId)}&case_id=eq.${encodeURIComponent(caseId)}&service_type=eq.human_case_review&payment_status=eq.paid&select=id&limit=1`,
    { method: "GET" },
  ).catch((error) => {
    if (process.env.NODE_ENV !== "production") {
      console.error("Não foi possível verificar ordem paga de revisão humana.", error);
    }
    return [];
  });

  return orders.length > 0;
}

async function createHumanReviewQueueRow(caseId: string) {
  try {
    await supabaseAdminRequest(
      "/rest/v1/human_reviews",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ case_id: caseId, status: "pending" }),
      },
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Não foi possível criar registro em human_reviews.", error);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para solicitar revisão humana." }, { status: 401 });

    const body = await request.json().catch(() => null) as { caseId?: unknown } | null;
    const caseId = typeof body?.caseId === "string" ? body.caseId.trim() : "";
    if (!caseId) return NextResponse.json({ error: "Informe o caseId para solicitar revisão humana." }, { status: 400 });

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(caseId, token);
    if (!caseData) return NextResponse.json({ error: "Caso não encontrado." }, { status: 404 });
    if (caseData.user_id !== user.id) return NextResponse.json({ error: "Você só pode solicitar revisão para seus próprios casos." }, { status: 403 });

    if (caseData.status === "deleted" || caseData.deleted_at) {
      throw new FriendlyRequestError("Não é possível solicitar revisão humana para um caso excluído.", 400);
    }

    if (["human_reviewed", "completed"].includes(caseData.status ?? "")) {
      throw new FriendlyRequestError("O status atual do caso não permite solicitar nova revisão humana.", 400);
    }

    if (caseData.human_review_requested && caseData.human_review_status === "waiting_review") {
      return NextResponse.json({
        success: true,
        case: {
          id: caseData.id,
          status: caseData.status,
          human_review_requested: caseData.human_review_requested,
          human_review_status: caseData.human_review_status,
          updated_at: caseData.updated_at ?? null,
        },
      });
    }

    const hasPaidOrder = await hasPaidHumanReviewOrder(user.id, caseId);
    let shouldRecordUsage = false;

    if (!hasPaidOrder) {
      await assertPlanLimit(user.id, "human_review");
      shouldRecordUsage = true;
    }

    const now = new Date().toISOString();
    const updatedCase = (
      await supabaseRequest<UpdatedCase[]>(
        `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,status,human_review_requested,human_review_status,updated_at`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            human_review_requested: true,
            human_review_status: "waiting_review",
            status: "waiting_human_review",
            updated_at: now,
          }),
        },
        token,
        getSupabaseConfig(),
      )
    )[0];

    if (!updatedCase) {
      throw new FriendlyRequestError("Caso não encontrado ou sem permissão para atualização.", 404);
    }

    await createHumanReviewQueueRow(caseId);
    if (shouldRecordUsage) {
      await recordUsageEvent(user.id, "human_review").catch((error) => {
        if (process.env.NODE_ENV !== "production") console.error("Não foi possível registrar uso de revisão humana.", error);
      });
    }
    await logActivity(caseId, user.id, token);

    return NextResponse.json({ success: true, case: updatedCase });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json(
        {
          error: PLAN_LIMIT_REACHED_MESSAGE,
          redirectTo: "/revisao-humana",
          offers: [
            { label: "Revisão avulsa", price: 19700 },
            { label: "Premium mensal", price: 39700 },
          ],
        },
        { status: error.status },
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("Erro ao solicitar revisão humana.", error);
    }

    const status = error instanceof FriendlyRequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Não foi possível solicitar revisão humana.";
    return NextResponse.json({ error: message }, { status });
  }
}

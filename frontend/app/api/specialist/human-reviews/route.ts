import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import { ACTIVE_REVIEW_CASE_STATUSES, HumanReviewRow, resolveDraftTarget } from "../../../../lib/agronomic/review-workflow";

type Profile = {
  role: "client" | "specialist" | "admin";
};

type HumanReviewAction = "draft" | "finalize" | "generate_report";

type HumanReviewPayload = {
  caseId?: string;
  reviewText?: string;
  technicalRecommendation?: string;
  finalObservations?: string;
  action?: HumanReviewAction;
};

const REVIEW_SELECT = "id,case_id,specialist_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at";

type CreatedReport = {
  id: string;
};

async function getSpecialistProfile(token: string, userId: string) {
  const profiles = await supabaseRequest<Profile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`,
    { method: "GET" },
    token
  );

  return profiles[0] ?? null;
}

function isAllowedRole(role?: string | null) {
  return role === "specialist" || role === "admin";
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validateAction(value: unknown): HumanReviewAction {
  return value === "finalize" || value === "generate_report" || value === "draft" ? value : "draft";
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para registrar a revisão técnica." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const profile = await getSpecialistProfile(token, user.id);

    if (!isAllowedRole(profile?.role)) {
      return NextResponse.json({ error: "Acesso negado. Apenas especialistas e administradores podem revisar casos." }, { status: 403 });
    }

    const payload = (await request.json().catch(() => null)) as HumanReviewPayload | null;
    const caseId = payload?.caseId?.trim();
    const action = validateAction(payload?.action);
    const reviewText = cleanText(payload?.reviewText);
    const technicalRecommendation = cleanText(payload?.technicalRecommendation);
    const finalObservations = cleanText(payload?.finalObservations);

    if (!caseId) {
      return NextResponse.json({ error: "Informe o caso que será revisado." }, { status: 400 });
    }

    if ((action === "finalize" || action === "generate_report") && (!reviewText || !technicalRecommendation)) {
      return NextResponse.json({ error: "Preencha revisão técnica e recomendação técnica antes de finalizar." }, { status: 400 });
    }

    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData || !caseData.human_review_requested) {
      return NextResponse.json({ error: "Caso não encontrado ou sem solicitação de revisão humana." }, { status: 404 });
    }

    // Vale também para rascunhos: um parecer finalizado não volta a ser rascunho.
    if (!(ACTIVE_REVIEW_CASE_STATUSES as readonly string[]).includes(caseData.human_review_status ?? "")) {
      return NextResponse.json(
        {
          error:
            action === "draft"
              ? "Este parecer já foi finalizado e não pode mais ser salvo como rascunho."
              : "Este caso não está aguardando revisão humana."
        },
        { status: 409 }
      );
    }

    const config = getSupabaseConfig();
    const reviewStatus = action === "draft" ? "in_review" : "completed";
    const reviewFields = {
      review_text: reviewText,
      technical_recommendation: technicalRecommendation,
      final_observations: finalObservations,
      status: reviewStatus,
      reviewed_at: action === "draft" ? null : new Date().toISOString()
    };

    // Reaproveita o rascunho existente em vez de inserir um registro a cada salvamento.
    const existingReviews = await supabaseRequest<HumanReviewRow[]>(
      `/rest/v1/human_reviews?case_id=eq.${encodeURIComponent(caseId)}&select=${REVIEW_SELECT}&order=created_at.desc`,
      { method: "GET" },
      token,
      config
    );
    const target = resolveDraftTarget(existingReviews, user.id, profile?.role === "admin");

    if (target.kind === "conflict") {
      return NextResponse.json(
        { error: "Este caso já possui um rascunho em edição por outra especialista." },
        { status: 409 }
      );
    }

    const savedReviews =
      target.kind === "update"
        ? await supabaseRequest<HumanReviewRow[]>(
            `/rest/v1/human_reviews?id=eq.${encodeURIComponent(target.row.id)}&select=${REVIEW_SELECT}`,
            {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify(reviewFields)
            },
            token,
            config
          )
        : await supabaseRequest<HumanReviewRow[]>(
            `/rest/v1/human_reviews?select=${REVIEW_SELECT}`,
            {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({ case_id: caseId, specialist_id: user.id, ...reviewFields })
            },
            token,
            config
          );
    const review = savedReviews[0];

    if (!review) {
      throw new Error(
        target.kind === "update"
          ? "Não foi possível atualizar o rascunho do parecer."
          : "Não foi possível criar o registro de revisão humana."
      );
    }

    const savedAt = new Date().toISOString();

    if (action === "draft") {
      await supabaseRequest(
        `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ human_review_status: "in_review" })
        },
        token,
        config
      );

      return NextResponse.json({ reviewId: review.id, status: "draft_saved", review, savedAt });
    }

    await supabaseRequest(
      `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          human_review_status: "reviewed",
          status: "human_reviewed"
        })
      },
      token,
      config
    );

    let report: CreatedReport | null = null;

    if (action === "generate_report") {
      const reports = await supabaseRequest<CreatedReport[]>(
        "/rest/v1/reports?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            case_id: caseId,
            user_id: caseData.user_id,
            report_type: "human_review_final",
            report_url: null
          })
        },
        token,
        config
      );
      report = reports[0] ?? null;
    }

    return NextResponse.json({
      reviewId: review.id,
      reportId: report?.id ?? null,
      status: action === "generate_report" ? "report_prepared" : "review_finalized",
      review,
      savedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

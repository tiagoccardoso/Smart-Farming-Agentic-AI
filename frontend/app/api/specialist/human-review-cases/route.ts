import { NextRequest, NextResponse } from "next/server";
import { AgronomicCase, AgronomicCaseImage, AgronomicFarm, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import {
  ACTIVE_REVIEW_CASE_STATUSES,
  COMPLETED_REVIEWS_LIMIT,
  COMPLETED_REVIEW_CASE_STATUSES,
  HumanReviewRow,
  pickCurrentReview
} from "../../../../lib/agronomic/review-workflow";

type Profile = {
  role: "client" | "specialist" | "admin";
};

type CaseRow = Omit<AgronomicCase, "farm" | "images">;

type SpecialistName = {
  id: string;
  full_name: string | null;
};

const CASE_SELECT =
  "id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,human_review_requested,human_review_status,created_at,updated_at,farm_id";
const REVIEW_SELECT = "id,case_id,specialist_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at";

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

function inFilter(values: readonly string[]) {
  return `in.(${values.map(encodeURIComponent).join(",")})`;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para acessar o painel da especialista." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const profile = await getSpecialistProfile(token, user.id);

    if (!isAllowedRole(profile?.role)) {
      return NextResponse.json({ error: "Acesso negado. Apenas especialistas e administradores podem visualizar esta fila." }, { status: 403 });
    }

    const config = getSupabaseConfig();

    // Pendentes (waiting_review) e rascunhos (in_review) aparecem sempre. Antes
    // a fila buscava só waiting_review, e o caso sumia ao salvar o rascunho.
    // Os concluídos ficam limitados aos mais recentes, para consulta rápida.
    const [activeCases, completedCases] = await Promise.all([
      supabaseRequest<CaseRow[]>(
        `/rest/v1/agronomic_cases?human_review_requested=eq.true&human_review_status=${inFilter(ACTIVE_REVIEW_CASE_STATUSES)}&deleted_at=is.null&select=${CASE_SELECT}&order=created_at.asc`,
        { method: "GET" },
        token,
        config
      ),
      supabaseRequest<CaseRow[]>(
        `/rest/v1/agronomic_cases?human_review_requested=eq.true&human_review_status=${inFilter(COMPLETED_REVIEW_CASE_STATUSES)}&deleted_at=is.null&select=${CASE_SELECT}&order=updated_at.desc&limit=${COMPLETED_REVIEWS_LIMIT}`,
        { method: "GET" },
        token,
        config
      )
    ]);
    const cases = [...activeCases, ...completedCases];

    const farmIds = Array.from(new Set(cases.map((caseData) => caseData.farm_id).filter((farmId): farmId is string => Boolean(farmId))));
    const caseIds = cases.map((caseData) => caseData.id);

    const [farms, images, reviews] = await Promise.all([
      farmIds.length > 0
        ? supabaseRequest<AgronomicFarm[]>(
            `/rest/v1/farms?id=in.(${farmIds.map(encodeURIComponent).join(",")})&select=id,name,city,state,area_hectares,soil_type`,
            { method: "GET" },
            token,
            config
          )
        : Promise.resolve([]),
      caseIds.length > 0
        ? supabaseRequest<AgronomicCaseImage[]>(
            `/rest/v1/case_images?case_id=in.(${caseIds.map(encodeURIComponent).join(",")})&select=id,case_id,image_url,image_type,created_at&order=created_at.asc`,
            { method: "GET" },
            token,
            config
          )
        : Promise.resolve([]),
      caseIds.length > 0
        ? supabaseRequest<HumanReviewRow[]>(
            `/rest/v1/human_reviews?case_id=in.(${caseIds.map(encodeURIComponent).join(",")})&select=${REVIEW_SELECT}&order=created_at.desc`,
            { method: "GET" },
            token,
            config
          )
        : Promise.resolve([])
    ]);

    const currentReviewByCase = new Map(
      cases.map((caseData) => [
        caseData.id,
        pickCurrentReview(
          reviews.filter((review) => review.case_id === caseData.id),
          caseData.human_review_status
        )
      ])
    );

    // O nome do responsável é apenas informativo: se o perfil não puder ser
    // lido, o painel mostra um rótulo genérico.
    const specialistIds = Array.from(
      new Set(
        Array.from(currentReviewByCase.values())
          .map((review) => review?.specialist_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const specialistNames =
      specialistIds.length > 0
        ? await supabaseRequest<SpecialistName[]>(
            `/rest/v1/profiles?id=in.(${specialistIds.map(encodeURIComponent).join(",")})&select=id,full_name`,
            { method: "GET" },
            token,
            config
          ).catch(() => [] as SpecialistName[])
        : [];

    const casesWithRelations = cases.map((caseData) => {
      const review = currentReviewByCase.get(caseData.id) ?? null;

      return {
        ...caseData,
        farm: farms.find((farm) => farm.id === caseData.farm_id) ?? null,
        images: images.filter((image) => image.case_id === caseData.id),
        review: review
          ? {
              ...review,
              is_mine: review.specialist_id === user.id,
              specialist_name: specialistNames.find((item) => item.id === review.specialist_id)?.full_name ?? null
            }
          : null
      };
    });

    return NextResponse.json({ cases: casesWithRelations, role: profile.role, currentUserId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar a fila de revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

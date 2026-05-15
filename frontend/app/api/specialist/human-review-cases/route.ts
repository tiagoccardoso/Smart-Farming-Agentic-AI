import { NextRequest, NextResponse } from "next/server";
import { AgronomicCase, AgronomicCaseImage, AgronomicFarm, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";

type Profile = {
  role: "client" | "specialist" | "admin";
};

type CaseRow = Omit<AgronomicCase, "farm" | "images">;

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
    const cases = await supabaseRequest<CaseRow[]>(
      "/rest/v1/agronomic_cases?human_review_requested=eq.true&human_review_status=eq.waiting_review&select=id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,human_review_requested,human_review_status,created_at,farm_id&order=created_at.asc",
      { method: "GET" },
      token,
      config
    );

    const farmIds = Array.from(new Set(cases.map((caseData) => caseData.farm_id).filter((farmId): farmId is string => Boolean(farmId))));
    const caseIds = cases.map((caseData) => caseData.id);

    const [farms, images] = await Promise.all([
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
        : Promise.resolve([])
    ]);

    const casesWithRelations = cases.map((caseData) => ({
      ...caseData,
      farm: farms.find((farm) => farm.id === caseData.farm_id) ?? null,
      images: images.filter((image) => image.case_id === caseData.id)
    }));

    return NextResponse.json({ cases: casesWithRelations, role: profile.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar a fila de revisão humana.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

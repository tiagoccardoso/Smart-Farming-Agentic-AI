import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../../lib/agronomic/case";

export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para duplicar o caso." }, { status: 401 });
    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(params.caseId, token);
    if (!caseData) return NextResponse.json({ error: "Caso não encontrado ou sem permissão." }, { status: 404 });
    if (caseData.user_id !== user.id) return NextResponse.json({ error: "Você só pode duplicar seus próprios casos." }, { status: 403 });

    const config = getSupabaseConfig();
    const farmRows = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/farms?select=id",
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: user.id, name: `${caseData.farm?.name ?? "Propriedade"} (cópia)`, city: caseData.farm?.city ?? null, state: caseData.farm?.state ?? null, area_hectares: caseData.farm?.area_hectares ?? null, soil_type: caseData.farm?.soil_type ?? null }) },
      token,
      config,
    );
    const duplicated = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/agronomic_cases?select=id",
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: user.id, farm_id: farmRows[0]?.id ?? null, crop: caseData.crop, growth_stage: caseData.growth_stage, symptoms: caseData.symptoms, history: caseData.history, soil_analysis_url: caseData.soil_analysis_url, status: "draft" }) },
      token,
      config,
    );
    const caseId = duplicated[0]?.id;
    if (!caseId) throw new Error("Não foi possível duplicar o caso.");
    await supabaseRequest(
      "/rest/v1/case_activity_logs",
      { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: caseId, user_id: user.id, action: "Caso duplicado", metadata: { sourceCaseId: params.caseId } }) },
      token,
      config,
    ).catch(() => null);
    return NextResponse.json({ caseId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível duplicar o caso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

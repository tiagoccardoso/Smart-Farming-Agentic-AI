import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseConfig,
  supabaseRequest,
} from "../../../lib/agronomic/case";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams
      .get("search")
      ?.trim()
      .replace(/[(),*]/g, " ")
      .replace(/\s+/g, " ");
    const filters = [
      "select=id,name,slug,aliases,model_label,display_name_pt,display_name_en,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,active,created_at,updated_at",
      "active=eq.true",
      "order=display_name_pt.asc",
    ];

    if (search) {
      filters.push(
        `or=${encodeURIComponent(`(name.ilike.*${search}*,display_name_pt.ilike.*${search}*,display_name_en.ilike.*${search}*,model_label.ilike.*${search}*,slug.ilike.*${search}*,scientific_name.ilike.*${search}*)`)}`,
      );
    }

    const config = getSupabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const accessKey = serviceRoleKey || config.anonKey;
    const rows = await supabaseRequest(
      `/rest/v1/crops?${filters.join("&")}`,
      { method: "GET" },
      accessKey,
      { ...config, anonKey: accessKey },
    );
    return NextResponse.json({ crops: rows });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível listar culturas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

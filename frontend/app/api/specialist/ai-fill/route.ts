import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";
import { openAIProvider } from "../../../../src/lib/ai/providers/openai";

type Profile = { id: string; role: UserRole; status?: "active" | "inactive" | null };
type FillType = "crop" | "disease";
const getToken = (request: NextRequest) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
const cleanText = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const cleanNullable = (value: unknown) => cleanText(value) ?? "";

function adminCfg() { const c = getSupabaseConfig(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente"); return { ...c, anonKey: key }; }

async function ensureSpecialist(token: string) {
  const user = await getAuthenticatedUser(token);
  const rows = await supabaseRequest<Profile[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`, { method: "GET" }, token);
  const p = rows[0];
  if (!p || !["admin", "specialist"].includes(p.role) || (p.status ?? "active") !== "active") return { error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }) };
  return { user };
}

export async function POST(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Faça login." }, { status: 401 });
    const auth = await ensureSpecialist(token);
    if (auth.error) return auth.error;

    const payload = (await request.json().catch(() => null)) as { type?: FillType; name?: string } | null;
    const type = payload?.type;
    const name = payload?.name?.trim();
    if (!type || !name) return NextResponse.json({ error: "Informe tipo e nome." }, { status: 400 });

    let cropsList = "";
    if (type === "disease") {
      const cfg = adminCfg();
      const crops = await supabaseRequest<Array<{ id: string; display_name_pt: string | null; name: string }>>("/rest/v1/crops?select=id,name,display_name_pt&active=eq.true&order=display_name_pt.asc", { method: "GET" }, cfg.anonKey, cfg);
      cropsList = crops.map((c) => `${c.id} | ${c.display_name_pt || c.name}`).join("\n");
    }

    const prompt = type === "crop"
      ? `Preencha JSON para cadastro de cultura. Nome base: "${name}". Campos: name,display_name_pt,display_name_en,slug,model_label,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,aliases(array),active(boolean). Retorne SOMENTE JSON válido.`
      : `Preencha JSON para cadastro de doença. Nome base: "${name}". Campos: common_name,scientific_name,disease_type,symptoms,severity_level,management_recommendations,is_active,crop_id (UUID ou null). Use apenas crop_id desta lista:\n${cropsList}\nSe não houver correspondência segura, use null. Retorne SOMENTE JSON válido.`;

    const result = await openAIProvider.generateStructuredOutput<Record<string, unknown>>([{ role: "system", content: "Você responde apenas JSON válido, sem markdown." }, { role: "user", content: prompt }], { maxOutputTokens: 1200, promptType: "specialist_catalog_fill" });
    const raw = result.content ?? {};

    if (type === "crop") {
      return NextResponse.json({ suggestion: { name: cleanNullable(raw.name) || name, display_name_pt: cleanNullable(raw.display_name_pt) || name, display_name_en: cleanNullable(raw.display_name_en), slug: cleanNullable(raw.slug), model_label: cleanNullable(raw.model_label), scientific_name: cleanNullable(raw.scientific_name), recommended_soil: cleanNullable(raw.recommended_soil), ideal_climate: cleanNullable(raw.ideal_climate), common_diseases: cleanNullable(raw.common_diseases), common_pests: cleanNullable(raw.common_pests), growth_cycle: cleanNullable(raw.growth_cycle), irrigation_notes: cleanNullable(raw.irrigation_notes), fertilization_notes: cleanNullable(raw.fertilization_notes), recommended_region: cleanNullable(raw.recommended_region), known_risks: cleanNullable(raw.known_risks), management_notes: cleanNullable(raw.management_notes), aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((x) => typeof x === "string").map((x) => String(x).trim()).filter(Boolean) : [name], active: typeof raw.active === "boolean" ? raw.active : true } });
    }

    return NextResponse.json({ suggestion: { common_name: cleanNullable(raw.common_name) || name, scientific_name: cleanNullable(raw.scientific_name), disease_type: cleanNullable(raw.disease_type), symptoms: cleanNullable(raw.symptoms), severity_level: cleanNullable(raw.severity_level), management_recommendations: cleanNullable(raw.management_recommendations), crop_id: cleanText(raw.crop_id), is_active: typeof raw.is_active === "boolean" ? raw.is_active : true } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Falha ao gerar sugestão por IA.";
    return NextResponse.json({ error: "Não foi possível gerar a sugestão com IA agora. Tente novamente em instantes.", detail }, { status: 500 });
  }
}

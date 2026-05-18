import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getSupabaseConfig,
  supabaseRequest,
} from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";

type Profile = {
  id: string;
  role: UserRole;
  status?: "active" | "inactive" | null;
};
type CropPayload = {
  id?: string;
  name?: string;
  slug?: string | null;
  aliases?: string[] | string | null;
  model_label?: string | null;
  display_name_pt?: string | null;
  display_name_en?: string | null;
  scientific_name?: string | null;
  recommended_soil?: string | null;
  ideal_climate?: string | null;
  common_diseases?: string | null;
  common_pests?: string | null;
  growth_cycle?: string | null;
  irrigation_notes?: string | null;
  fertilization_notes?: string | null;
  recommended_region?: string | null;
  known_risks?: string | null;
  management_notes?: string | null;
  active?: boolean;
};

function getAdminConfig() {
  const config = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error(
      "Configure SUPABASE_SERVICE_ROLE_KEY para gerenciar culturas.",
    );
  return { ...config, anonKey: key };
}

async function adminRequest<T>(path: string, init: RequestInit) {
  const config = getAdminConfig();
  return supabaseRequest<T>(path, init, config.anonKey, config);
}

function getToken(request: NextRequest) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null
  );
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanSlug(value: unknown, fallback: string | null) {
  const source = cleanText(value) ?? fallback;
  return source
    ? source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : null;
}

function cleanAliases(value: CropPayload["aliases"], requiredValues: Array<string | null>) {
  const aliases = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]/)
      : [];
  return Array.from(
    new Set(
      [...aliases, ...requiredValues]
        .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
        .filter(Boolean),
    ),
  );
}

async function ensureSpecialist(token: string) {
  const user = await getAuthenticatedUser(token);
  const rows = await supabaseRequest<Profile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`,
    { method: "GET" },
    token,
  );
  const profile = rows[0];

  if (
    !profile ||
    !["specialist", "admin"].includes(profile.role) ||
    (profile.status ?? "active") !== "active"
  ) {
    return {
      error: NextResponse.json(
        {
          error:
            "Acesso negado. Apenas specialist/admin ativos podem gerenciar culturas.",
        },
        { status: 403 },
      ),
    };
  }

  return { user, profile };
}

function mapPayload(payload: CropPayload) {
  const name = cleanText(payload.name);
  const displayNamePt = cleanText(payload.display_name_pt) ?? name;
  const slug = cleanSlug(payload.slug, displayNamePt);
  const modelLabel = cleanText(payload.model_label)?.toLowerCase() ?? null;
  const displayNameEn = cleanText(payload.display_name_en);
  const body = {
    name,
    slug,
    aliases: cleanAliases(payload.aliases, [name, displayNamePt, displayNameEn, modelLabel, slug]),
    model_label: modelLabel,
    display_name_pt: displayNamePt,
    display_name_en: displayNameEn,
    scientific_name: cleanText(payload.scientific_name),
    recommended_soil: cleanText(payload.recommended_soil),
    ideal_climate: cleanText(payload.ideal_climate),
    common_diseases: cleanText(payload.common_diseases),
    common_pests: cleanText(payload.common_pests),
    growth_cycle: cleanText(payload.growth_cycle),
    irrigation_notes: cleanText(payload.irrigation_notes),
    fertilization_notes: cleanText(payload.fertilization_notes),
    recommended_region: cleanText(payload.recommended_region),
    known_risks: cleanText(payload.known_risks),
    management_notes: cleanText(payload.management_notes),
    active: payload.active !== undefined ? Boolean(payload.active) : true,
  };

  return { name, body };
}

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token)
      return NextResponse.json(
        { error: "Faça login para listar culturas." },
        { status: 401 },
      );
    const auth = await ensureSpecialist(token);
    if (auth.error) return auth.error;

    const crops = await adminRequest(
      "/rest/v1/crops?select=id,name,slug,aliases,model_label,display_name_pt,display_name_en,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,active,created_at,updated_at&order=display_name_pt.asc",
      { method: "GET" },
    );
    return NextResponse.json({ crops });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível listar culturas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token)
      return NextResponse.json(
        { error: "Faça login para cadastrar culturas." },
        { status: 401 },
      );
    const auth = await ensureSpecialist(token);
    if (auth.error) return auth.error;

    const payload = (await request
      .json()
      .catch(() => null)) as CropPayload | null;
    const { name, body } = mapPayload(payload ?? {});
    if (!name || !body.slug || !body.display_name_pt)
      return NextResponse.json(
        { error: "Nome, slug e nome em português da cultura são obrigatórios." },
        { status: 400 },
      );

    const rows = await adminRequest(
      "/rest/v1/crops?select=id,name,slug,aliases,model_label,display_name_pt,display_name_en,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,active,created_at,updated_at",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json({ crop: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível cadastrar cultura.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token)
      return NextResponse.json(
        { error: "Faça login para editar culturas." },
        { status: 401 },
      );
    const auth = await ensureSpecialist(token);
    if (auth.error) return auth.error;

    const payload = (await request
      .json()
      .catch(() => null)) as CropPayload | null;
    const id = payload?.id?.trim();
    if (!id)
      return NextResponse.json(
        { error: "Informe a cultura que será editada." },
        { status: 400 },
      );

    const { name, body } = mapPayload(payload ?? {});
    if (!name || !body.slug || !body.display_name_pt)
      return NextResponse.json(
        { error: "Nome, slug e nome em português da cultura são obrigatórios." },
        { status: 400 },
      );

    const rows = await adminRequest(
      `/rest/v1/crops?id=eq.${encodeURIComponent(id)}&select=id,name,slug,aliases,model_label,display_name_pt,display_name_en,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,active,created_at,updated_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json({ crop: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível editar cultura.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

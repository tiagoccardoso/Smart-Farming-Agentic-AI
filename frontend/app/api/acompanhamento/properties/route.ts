import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "../../../../lib/auth";

function getConfig() { const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; if (!supabaseUrl || !anonKey) throw new Error("Supabase não configurado"); return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey }; }
async function req<T>(path: string, init: RequestInit, token: string, c: ReturnType<typeof getConfig>) { const r = await fetch(`${c.supabaseUrl}${path}`, { ...init, headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }, cache: "no-store" }); const t = await r.text(); const p = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(p?.message || p?.error || "Erro no Supabase"); return p as T; }

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const c = getConfig(); const user = await getCurrentUser(token, c); const profile = await getCurrentProfile(token, user.id, c);
    if (!profile || !["admin", "specialist"].includes(profile.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const rows = await req<Array<{ id: string; name: string; owner_name: string | null }>>(`/rest/v1/acompanhamento_properties?select=id,name,owner_name&order=name.asc`, { method: "GET" }, token, c);
    return NextResponse.json({ properties: rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "erro" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const c = getConfig(); const user = await getCurrentUser(token, c); const profile = await getCurrentProfile(token, user.id, c);
    if (!profile || !["admin", "specialist"].includes(profile.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const body = await request.json();
    if (!String(body.name || "").trim()) return NextResponse.json({ error: "Nome da propriedade é obrigatório." }, { status: 400 });
    if (!String(body.owner_name || "").trim()) return NextResponse.json({ error: "Proprietário é obrigatório." }, { status: 400 });

    const payload = {
      owner_id: user.id,
      specialist_id: profile.role === "specialist" ? user.id : null,
      name: body.name,
      owner_name: body.owner_name,
      location_gps: body.location_gps || null,
      total_area_ha: body.total_area_ha || null,
      sectors: body.sectors || [],
      soil_type: body.soil_type || null,
      altitude_m: body.altitude_m || null,
      area_history: body.area_history || null,
      photo_urls: body.photo_urls || []
    };
    const rows = await req<Array<{ id: string }>>(`/rest/v1/acompanhamento_properties?select=*`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, token, c);
    return NextResponse.json({ property: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "erro" }, { status: 400 });
  }
}

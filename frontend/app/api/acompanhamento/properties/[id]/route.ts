import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "../../../../../lib/auth";

function getConfig() { const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; if (!supabaseUrl || !anonKey) throw new Error("Supabase não configurado"); return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey }; }
async function req<T>(path: string, init: RequestInit, token: string, c: ReturnType<typeof getConfig>) { const r = await fetch(`${c.supabaseUrl}${path}`, { ...init, headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }, cache: "no-store" }); const t = await r.text(); const p = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(p?.message || p?.error || "Erro no Supabase"); return p as T; }

async function auth(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("unauthorized");
  const c = getConfig();
  const user = await getCurrentUser(token, c);
  const profile = await getCurrentProfile(token, user.id, c);
  if (!profile || !["admin", "specialist"].includes(profile.role)) throw new Error("forbidden");
  return { token, c };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { token, c } = await auth(request);
    const { id } = await params;
    const body = await request.json();
    const payload = {
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
    const rows = await req<unknown[]>(`/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(id)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, token, c);
    return NextResponse.json({ property: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "erro" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { token, c } = await auth(request);
    const { id } = await params;
    await req(`/rest/v1/acompanhamento_properties?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }, token, c);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "erro" }, { status: 400 });
  }
}

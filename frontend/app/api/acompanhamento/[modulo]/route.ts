import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "../../../../lib/auth";

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase não configurado");
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

async function req<T>(path: string, init: RequestInit, token: string, c: ReturnType<typeof getConfig>) {
  const r = await fetch(`${c.supabaseUrl}${path}`, { ...init, headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers||{}) }, cache: "no-store" });
  const t = await r.text(); const p = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(p?.message || p?.error || "Erro no Supabase");
  return p as T;
}

async function auth(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("unauthorized");
  const c = getConfig();
  const user = await getCurrentUser(token, c);
  const profile = await getCurrentProfile(token, user.id, c);
  if (!profile || !["admin", "specialist"].includes(profile.role)) throw new Error("forbidden");
  return { token, user, profile, c };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ modulo: string }> }) {
  try {
    const { token, c } = await auth(request);
    const { modulo } = await params;
    const rows = await req<unknown[]>(`/rest/v1/acompanhamento_records?module_slug=eq.${encodeURIComponent(modulo)}&select=*&order=created_at.desc`, { method: "GET" }, token, c);
    return NextResponse.json({ records: rows });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 401 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ modulo: string }> }) {
  try {
    const { token, c, user } = await auth(request);
    const { modulo } = await params;
    const body = await request.json();
    if (!body.title?.trim()) return NextResponse.json({ error: "Título é obrigatório." }, { status: 400 });
    const rows = await req<unknown[]>(`/rest/v1/acompanhamento_records?select=*`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...body, module_slug: modulo, owner_id: body.owner_id || user.id }) }, token, c);
    return NextResponse.json({ record: rows[0] });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 400 }); }
}

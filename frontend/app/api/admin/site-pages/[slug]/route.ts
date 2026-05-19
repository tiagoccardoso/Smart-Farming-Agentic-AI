import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../../lib/agronomic/case";
import { sitePageFallbacks } from "../../../../../lib/site-pages";

async function ensureSpecialistOrAdmin(token: string) {
  const user = await getAuthenticatedUser(token);
  const profile = (await supabaseRequest<any[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`, { method: "GET" }, token))[0];
  if (!profile || !["admin", "specialist"].includes(profile.role) || (profile.status ?? "active") !== "active") return null;
  return user;
}

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await ensureSpecialistOrAdmin(token))) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const rows = await supabaseRequest<any[]>(`/rest/v1/site_pages?slug=eq.${encodeURIComponent(params.slug)}&select=*&limit=1`, { method: "GET" }, token);
  return NextResponse.json({ page: rows[0] ?? sitePageFallbacks[params.slug] ?? null });
}

export async function PUT(request: NextRequest, { params }: { params: { slug: string } }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const user = await ensureSpecialistOrAdmin(token);
  if (!user) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await request.json();
  const title = String(body?.title ?? "").trim();
  const subtitle = String(body?.subtitle ?? "").trim();
  const image_url = String(body?.image_url ?? "").trim();
  const content = body?.content && typeof body.content === "object" ? body.content : {};
  if (!title || !["especialista", "agricultura-organica", "home"].includes(params.slug)) {
    return NextResponse.json({ error: "Conteúdo inválido." }, { status: 400 });
  }

  const rows = await supabaseRequest<any[]>("/rest/v1/site_pages?on_conflict=slug&select=*", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ slug: params.slug, title, subtitle: subtitle || null, image_url: image_url || null, content, updated_by: user.id, updated_at: new Date().toISOString() }),
  }, token);

  return NextResponse.json({ page: rows[0], message: "Conteúdo salvo com sucesso." });
}

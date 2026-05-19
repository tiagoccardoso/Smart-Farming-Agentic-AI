import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../../../lib/agronomic/case";

const BUCKET = "site-images";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];

async function ensureSpecialistOrAdmin(token: string) {
  const user = await getAuthenticatedUser(token);
  const profile = (await supabaseRequest<any[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`, { method: "GET" }, token))[0];
  if (!profile || !["admin", "specialist"].includes(profile.role) || (profile.status ?? "active") !== "active") return null;
  return user;
}

function extractStoragePath(url?: string | null) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  return index >= 0 ? url.slice(index + marker.length) : null;
}

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const user = await ensureSpecialistOrAdmin(token);
  if (!user) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!["home", "especialista", "agricultura-organica"].includes(params.slug)) return NextResponse.json({ error: "Página inválida." }, { status: 400 });

  const data = await request.formData();
  const image = data.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 400 });
  if (!ACCEPTED_MIME.includes(image.type)) return NextResponse.json({ error: "Formato de imagem inválido. Envie JPG, PNG ou WEBP." }, { status: 400 });
  if (image.size > MAX_IMAGE_SIZE) return NextResponse.json({ error: "Imagem muito grande. Envie um arquivo menor." }, { status: 400 });

  const config = getSupabaseConfig();
  const extension = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
  const path = `${params.slug}/${user.id}/${Date.now()}.${extension}`;
  const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": image.type, "x-upsert": "true" }, body: Buffer.from(await image.arrayBuffer()) });
  if (!upload.ok) return NextResponse.json({ error: "Não foi possível enviar a imagem. Tente novamente." }, { status: 502 });

  const pageRows = await supabaseRequest<any[]>(`/rest/v1/site_pages?slug=eq.${encodeURIComponent(params.slug)}&select=image_url&limit=1`, { method: "GET" }, token);
  const oldPath = extractStoragePath(pageRows[0]?.image_url);
  if (oldPath && oldPath !== path) {
    await fetch(`${config.supabaseUrl}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [oldPath] }) });
  }

  const image_url = `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
  return NextResponse.json({ image_url, message: "Imagem enviada com sucesso." });
}

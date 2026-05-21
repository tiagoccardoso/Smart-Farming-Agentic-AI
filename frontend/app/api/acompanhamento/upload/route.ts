import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser, getSupabaseAuthConfig } from "../../../../lib/auth";

const BUCKET = "acompanhamento-anexos";
const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

function sanitize(name: string) { return name.replace(/[^a-zA-Z0-9._-]/g, "_"); }

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const cfg = getSupabaseAuthConfig();
    const user = await getCurrentUser(token, cfg);
    const profile = await getCurrentProfile(token, user.id, cfg);
    if (!profile || !["admin", "specialist"].includes(profile.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const data = await request.formData();
    const file = data.get("file");
    const modulo = String(data.get("modulo") || "geral");
    if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo vazio ou acima de 15MB." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Tipo de arquivo não permitido." }, { status: 400 });

    const path = `${user.id}/${modulo}/${Date.now()}-${sanitize(file.name)}`;
    const upload = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, "Content-Type": file.type, "x-upsert": "true" },
      body: Buffer.from(await file.arrayBuffer())
    });
    if (!upload.ok) return NextResponse.json({ error: "Falha no upload ao storage." }, { status: 502 });

    return NextResponse.json({ fileUrl: `${cfg.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../../lib/agronomic/case";

type Profile = { role: "client" | "specialist" | "admin" };

const BUCKET = "specialist-knowledge";
const MAX_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function getProfile(token: string, userId: string) {
  const rows = await supabaseRequest<Profile[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`, { method: "GET" }, token);
  return rows[0] ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para enviar arquivos." }, { status: 401 });

    const user = await getAuthenticatedUser(token);
    const profile = await getProfile(token, user.id);
    if (!profile || !["specialist", "admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Apenas especialistas/admin podem enviar arquivos para a base de conhecimento." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Nenhum arquivo válido foi enviado." }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
    if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "Arquivo excede o limite de 15MB." }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Tipo de arquivo inválido." }, { status: 400 });

    const config = getSupabaseConfig();
    const safeName = sanitizeFileName(file.name || "arquivo");
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const uploadResponse = await fetch(`${config.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type,
        "x-upsert": "false"
      },
      body: Buffer.from(await file.arrayBuffer())
    });

    if (!uploadResponse.ok) {
      return NextResponse.json({ error: "Não foi possível enviar o arquivo para o storage." }, { status: 502 });
    }

    return NextResponse.json({ fileUrl: `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`, fileName: safeName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar arquivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

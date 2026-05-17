import { NextRequest, NextResponse } from "next/server";
import { generateKnowledgeEmbedding } from "../../../../lib/ai/embeddings";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";

export type SpecialistKnowledgeCategory =
  | "protocolo"
  | "artigo"
  | "aula"
  | "recomendacao"
  | "faq"
  | "caso_pratico"
  | "manejo"
  | "solo"
  | "pragas"
  | "doencas";

type Profile = {
  role: "client" | "specialist" | "admin";
};

type KnowledgePayload = {
  id?: string;
  title?: string;
  category?: SpecialistKnowledgeCategory;
  crop?: string;
  content?: string;
  file_url?: string;
  active?: boolean;
};

type KnowledgeMutationValue = string | boolean | number[] | null;

type KnowledgeMaterialRow = {
  id: string;
  title: string | null;
  category: SpecialistKnowledgeCategory | null;
  crop: string | null;
  content: string | null;
  file_url: string | null;
  active: boolean | null;
};

const categories = new Set<SpecialistKnowledgeCategory>([
  "protocolo",
  "artigo",
  "aula",
  "recomendacao",
  "faq",
  "caso_pratico",
  "manejo",
  "solo",
  "pragas",
  "doencas"
]);

async function getSpecialistProfile(token: string, userId: string) {
  const profiles = await supabaseRequest<Profile[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`,
    { method: "GET" },
    token
  );

  return profiles[0] ?? null;
}

function isAllowedRole(role?: string | null) {
  return role === "specialist" || role === "admin";
}

function cleanOptionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validateCategory(value: unknown) {
  if (typeof value !== "string" || !categories.has(value as SpecialistKnowledgeCategory)) {
    return null;
  }

  return value as SpecialistKnowledgeCategory;
}

function requireToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}


async function generateKnowledgeEmbeddingSafely(input: {
  title?: string | null;
  category?: string | null;
  crop?: string | null;
  content?: string | null;
  fileUrl?: string | null;
}) {
  try {
    return await generateKnowledgeEmbedding(input);
  } catch (error) {
    console.warn("Não foi possível gerar embedding para specialist_knowledge; o conteúdo será salvo sem vetor semântico.", error);
    return null;
  }
}

async function getKnowledgeMaterialById(id: string, token: string) {
  const rows = await supabaseRequest<KnowledgeMaterialRow[]>(
    `/rest/v1/specialist_knowledge?id=eq.${encodeURIComponent(id)}&select=id,title,category,crop,content,file_url,active&limit=1`,
    { method: "GET" },
    token,
    getSupabaseConfig()
  );

  return rows[0] ?? null;
}

function shouldRefreshEmbedding(payload: KnowledgePayload) {
  return ["title", "category", "crop", "content", "file_url"].some((key) => key in payload);
}

async function ensureSpecialist(token: string) {
  const user = await getAuthenticatedUser(token);
  const profile = await getSpecialistProfile(token, user.id);

  if (!isAllowedRole(profile?.role)) {
    return { error: NextResponse.json({ error: "Acesso negado. Apenas especialistas e administradores podem gerenciar a base de conhecimento." }, { status: 403 }) };
  }

  return { user, profile };
}

export async function GET(request: NextRequest) {
  try {
    const token = requireToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para acessar a base de conhecimento." }, { status: 401 });
    }

    const auth = await ensureSpecialist(token);

    if (auth.error) {
      return auth.error;
    }

    const { searchParams } = new URL(request.url);
    const crop = cleanOptionalText(searchParams.get("crop"));
    const category = validateCategory(searchParams.get("category"));
    const filters = [
      "select=id,title,category,crop,content,file_url,created_by,active,created_at",
      "order=created_at.desc"
    ];

    if (crop) {
      filters.push(`crop=ilike.*${encodeURIComponent(crop)}*`);
    }

    if (category) {
      filters.push(`category=eq.${encodeURIComponent(category)}`);
    }

    const materials = await supabaseRequest(
      `/rest/v1/specialist_knowledge?${filters.join("&")}`,
      { method: "GET" },
      token,
      getSupabaseConfig()
    );

    return NextResponse.json({ materials, role: auth.profile.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar a base de conhecimento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = requireToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para cadastrar conteúdo técnico." }, { status: 401 });
    }

    const auth = await ensureSpecialist(token);

    if (auth.error) {
      return auth.error;
    }

    const payload = (await request.json().catch(() => null)) as KnowledgePayload | null;
    const title = cleanOptionalText(payload?.title);
    const category = validateCategory(payload?.category);
    const crop = cleanOptionalText(payload?.crop);
    const content = cleanOptionalText(payload?.content);
    const fileUrl = cleanOptionalText(payload?.file_url);

    if (!title) {
      return NextResponse.json({ error: "Informe um título para o conteúdo." }, { status: 400 });
    }

    if (!category) {
      return NextResponse.json({ error: "Selecione uma categoria válida." }, { status: 400 });
    }

    if (!content && !fileUrl) {
      return NextResponse.json({ error: "Informe o conteúdo técnico ou uma URL de arquivo." }, { status: 400 });
    }

    const embedding = await generateKnowledgeEmbeddingSafely({ title, category, crop, content, fileUrl });

    const materials = await supabaseRequest(
      "/rest/v1/specialist_knowledge?select=id,title,category,crop,content,file_url,created_by,active,created_at",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title,
          category,
          crop,
          content,
          file_url: fileUrl,
          created_by: auth.user.id,
          active: payload?.active ?? true,
          embedding
        })
      },
      token,
      getSupabaseConfig()
    );

    return NextResponse.json({ material: Array.isArray(materials) ? materials[0] : null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível cadastrar o conteúdo técnico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = requireToken(request);

    if (!token) {
      return NextResponse.json({ error: "Faça login para editar conteúdo técnico." }, { status: 401 });
    }

    const auth = await ensureSpecialist(token);

    if (auth.error) {
      return auth.error;
    }

    const payload = (await request.json().catch(() => null)) as KnowledgePayload | null;
    const id = cleanOptionalText(payload?.id);

    if (!id) {
      return NextResponse.json({ error: "Informe o conteúdo que será editado." }, { status: 400 });
    }

    const updates: Record<string, KnowledgeMutationValue> = {};

    if ("title" in (payload ?? {})) {
      const title = cleanOptionalText(payload?.title);

      if (!title) {
        return NextResponse.json({ error: "Informe um título para o conteúdo." }, { status: 400 });
      }

      updates.title = title;
    }

    if ("category" in (payload ?? {})) {
      const category = validateCategory(payload?.category);

      if (!category) {
        return NextResponse.json({ error: "Selecione uma categoria válida." }, { status: 400 });
      }

      updates.category = category;
    }

    if ("crop" in (payload ?? {})) {
      updates.crop = cleanOptionalText(payload?.crop);
    }

    if ("content" in (payload ?? {})) {
      updates.content = cleanOptionalText(payload?.content);
    }

    if ("file_url" in (payload ?? {})) {
      updates.file_url = cleanOptionalText(payload?.file_url);
    }

    if (typeof payload?.active === "boolean") {
      updates.active = payload.active;
    }

    if (shouldRefreshEmbedding(payload ?? {})) {
      const currentMaterial = await getKnowledgeMaterialById(id, token);

      if (!currentMaterial) {
        return NextResponse.json({ error: "Conteúdo técnico não encontrado." }, { status: 404 });
      }

      updates.embedding = await generateKnowledgeEmbeddingSafely({
        title: "title" in (payload ?? {}) ? (updates.title as string | null) : currentMaterial.title,
        category: "category" in (payload ?? {}) ? (updates.category as string | null) : currentMaterial.category,
        crop: "crop" in (payload ?? {}) ? (updates.crop as string | null) : currentMaterial.crop,
        content: "content" in (payload ?? {}) ? (updates.content as string | null) : currentMaterial.content,
        fileUrl: "file_url" in (payload ?? {}) ? (updates.file_url as string | null) : currentMaterial.file_url
      });
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Informe ao menos um campo para atualizar." }, { status: 400 });
    }

    const materials = await supabaseRequest(
      `/rest/v1/specialist_knowledge?id=eq.${encodeURIComponent(id)}&select=id,title,category,crop,content,file_url,created_by,active,created_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(updates)
      },
      token,
      getSupabaseConfig()
    );

    return NextResponse.json({ material: Array.isArray(materials) ? materials[0] : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível editar o conteúdo técnico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

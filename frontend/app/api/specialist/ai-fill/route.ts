import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";
import { openAIProvider } from "../../../../src/lib/ai/providers/openai";
import { parseJsonObject } from "../../../../src/lib/ai/utils/json-parser";
import { requireUuid } from "../../../../lib/server/uuid";

type Profile = { id: string; role: UserRole; status?: "active" | "inactive" | null };
type FillType = "crop" | "disease";
type OpenAIError = Error & { status?: number; code?: string; providerMessage?: string };
const getToken = (request: NextRequest) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
const cleanText = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const cleanNullable = (value: unknown) => cleanText(value) ?? "";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizeToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeToText(item))
      .filter(Boolean)
      .join("; ");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, val]) => {
        const parsed = normalizeToText(val);
        return parsed ? `${key}: ${parsed}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

const normalizeNullable = (value: unknown) => normalizeToText(value) || "";

function mapAiError(error: unknown) {
  const e = error as OpenAIError;
  const message = e?.message || "Falha ao gerar sugestão por IA.";
  const status = e?.status;
  const code = e?.code;

  if (message.includes("OPENAI_API_KEY")) return { status: 503, error: "Configuração de IA ausente no servidor." };
  if (status === 401 || code === "invalid_api_key") return { status: 502, error: "Falha de autenticação com o provedor de IA." };
  if (status === 403) return { status: 502, error: "Acesso negado pelo provedor de IA para este modelo/chave." };
  if (status === 404 || code === "model_not_found") return { status: 502, error: "Modelo de IA configurado não encontrado ou indisponível." };
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") return { status: 429, error: "Limite de uso da IA atingido no momento. Tente novamente em instantes." };
  if (status && status >= 500) return { status: 502, error: "Serviço de IA temporariamente indisponível." };
  if (message.includes("JSON válido")) return { status: 422, error: "A IA retornou dados em formato inválido para preenchimento automático." };
  return { status: 500, error: "Não foi possível gerar a sugestão com IA agora. Tente novamente em instantes." };
}

function parseAiPayload(raw: unknown) {
  if (isRecord(raw)) return raw;
  if (typeof raw === "string") return parseJsonObject<Record<string, unknown>>(raw);
  throw new Error("A IA não retornou um objeto JSON válido.");
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

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
    const validCropIds = new Set<string>();
    if (type === "disease") {
      const cfg = adminCfg();
      const crops = await supabaseRequest<Array<{ id: string; display_name_pt: string | null; name: string }>>("/rest/v1/crops?select=id,name,display_name_pt&active=eq.true&order=display_name_pt.asc", { method: "GET" }, cfg.anonKey, cfg);
      crops.forEach((crop) => validCropIds.add(crop.id));
      cropsList = crops.map((c) => `${c.id} | ${c.display_name_pt || c.name}`).join("\n");
    }

    const prompt = type === "crop"
      ? `Preencha um cadastro de cultura com base no nome "${name}".
Responda com APENAS um objeto JSON válido, sem markdown e sem texto extra.
Não inclua campos fora desta lista: name,display_name_pt,display_name_en,slug,model_label,scientific_name,recommended_soil,ideal_climate,common_diseases,common_pests,growth_cycle,irrigation_notes,fertilization_notes,recommended_region,known_risks,management_notes,aliases,active.
Regras:
- aliases deve ser array de strings;
- active deve ser boolean;
- campos textuais devem ser string (use "" quando não souber).
`
      : `Preencha um cadastro de doença com base no nome "${name}".
Responda com APENAS um objeto JSON válido, sem markdown e sem texto extra.
Não inclua campos fora desta lista: common_name,scientific_name,causal_agent,disease_type,symptoms,favorable_conditions,crop_stage,severity_level,management_recommendations,preventive_control,curative_control,technical_notes,is_active,crop_id.
Regras:
- is_active deve ser boolean;
- crop_id deve ser UUID desta lista ou null:
${cropsList}
- campos textuais devem ser string (use "" quando não souber).
`;

    const result = await openAIProvider.generateText(
      [
        {
          role: "system",
          content:
            "Você é um assistente de cadastro técnico agrícola. Responda exclusivamente com um único objeto JSON puro, sem markdown, sem comentários e sem texto adicional.",
        },
        { role: "user", content: prompt },
      ],
      { maxOutputTokens: 1200, promptType: "specialist_catalog_fill" },
    );

    const raw = parseAiPayload(result.content);

    if (type === "crop") {
      const suggestion = {
        name: normalizeNullable(raw.name) || name,
        display_name_pt: normalizeNullable(raw.display_name_pt) || name,
        display_name_en: normalizeNullable(raw.display_name_en),
        slug: normalizeNullable(raw.slug),
        model_label: normalizeNullable(raw.model_label),
        scientific_name: normalizeNullable(raw.scientific_name),
        recommended_soil: normalizeNullable(raw.recommended_soil),
        ideal_climate: normalizeNullable(raw.ideal_climate),
        common_diseases: normalizeNullable(raw.common_diseases),
        common_pests: normalizeNullable(raw.common_pests),
        growth_cycle: normalizeNullable(raw.growth_cycle),
        irrigation_notes: normalizeNullable(raw.irrigation_notes),
        fertilization_notes: normalizeNullable(raw.fertilization_notes),
        recommended_region: normalizeNullable(raw.recommended_region),
        known_risks: normalizeNullable(raw.known_risks),
        management_notes: normalizeNullable(raw.management_notes),
        aliases: Array.isArray(raw.aliases)
          ? raw.aliases.map((x) => normalizeToText(x)).map((x) => x.trim()).filter(Boolean)
          : normalizeToText(raw.aliases)
            ? [normalizeToText(raw.aliases)]
            : [name],
        active: normalizeBoolean(raw.active, true),
      };

      if (!suggestion.name || !suggestion.display_name_pt) {
        return NextResponse.json({ error: "A IA respondeu, mas não trouxe os campos obrigatórios da cultura (name e display_name_pt)." }, { status: 422 });
      }

      return NextResponse.json({ suggestion });
    }

    const cropId = cleanText(raw.crop_id);
    const normalizedCropId = cropId && requireUuid(cropId) && validCropIds.has(cropId) ? cropId : null;
    const suggestion = {
      common_name: normalizeNullable(raw.common_name) || name,
      scientific_name: normalizeNullable(raw.scientific_name),
      causal_agent: normalizeNullable(raw.causal_agent),
      disease_type: normalizeNullable(raw.disease_type),
      symptoms: normalizeNullable(raw.symptoms),
      favorable_conditions: normalizeNullable(raw.favorable_conditions),
      crop_stage: normalizeNullable(raw.crop_stage),
      severity_level: normalizeNullable(raw.severity_level),
      management_recommendations: normalizeNullable(raw.management_recommendations),
      preventive_control: normalizeNullable(raw.preventive_control),
      curative_control: normalizeNullable(raw.curative_control),
      technical_notes: normalizeNullable(raw.technical_notes),
      crop_id: normalizedCropId,
      is_active: normalizeBoolean(raw.is_active, true),
    };

    if (!suggestion.common_name) {
      return NextResponse.json({ error: "A IA respondeu, mas não trouxe o campo obrigatório da doença (common_name)." }, { status: 422 });
    }

    return NextResponse.json({ suggestion });
  } catch (e) {
    const mapped = mapAiError(e);
    const detail = e instanceof Error ? e.message : "Falha ao gerar sugestão por IA.";
    console.error("[specialist/ai-fill] Falha ao gerar sugestão", {
      type: "ai_fill",
      status: (e as OpenAIError)?.status,
      code: (e as OpenAIError)?.code,
      detail
    });
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

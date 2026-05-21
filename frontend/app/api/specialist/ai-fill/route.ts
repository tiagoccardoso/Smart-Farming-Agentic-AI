import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";
import { openAIProvider } from "../../../../src/lib/ai/providers/openai";
import { parseJsonObject } from "../../../../src/lib/ai/utils/json-parser";
import { requireUuid } from "../../../../lib/server/uuid";

type Profile = { id: string; role: UserRole; status?: "active" | "inactive" | null };
type FillType = "crop" | "disease";
type AiFillResponse<T> = { message: string; suggestion: T; assistant_message?: string; warnings?: string[] };
type DiseaseAiSuggestion = {
  common_name: string;
  scientific_name: string;
  causal_agent: string;
  disease_type: string;
  symptoms: string;
  favorable_conditions: string;
  crop_stage: string;
  severity_level: string;
  management_recommendations: string;
  preventive_control: string;
  curative_control: string;
  technical_notes: string;
  crop_id: string | null;
  is_active: boolean;
};

const diseaseFieldFallback = "Informação não confirmada. Recomenda-se validação técnica local.";

const diseaseFieldAliases: Record<keyof DiseaseAiSuggestion, string[]> = {
  common_name: ["common_name", "nome_comum", "nome", "doenca", "doença"],
  scientific_name: ["scientific_name", "nome_cientifico", "nome_científico"],
  causal_agent: ["causal_agent", "agente_causal", "patogeno", "patógeno"],
  disease_type: ["disease_type", "tipo_agente", "tipo_doenca", "tipo_doença"],
  symptoms: ["symptoms", "sintomas_principais", "sintomas"],
  favorable_conditions: ["favorable_conditions", "condicoes_favoraveis", "condições_favoráveis"],
  crop_stage: ["crop_stage", "periodo_critico_ocorrencia", "período_crítico_ocorrência"],
  severity_level: ["severity_level", "nivel_severidade", "nível_severidade"],
  management_recommendations: ["management_recommendations", "manejo_preventivo"],
  preventive_control: ["preventive_control", "controle_biologico_preventivo", "controle_biológico_preventivo"],
  curative_control: ["curative_control", "manejo_curativo_quimico", "manejo_curativo_químico"],
  technical_notes: ["technical_notes", "observacoes_tecnicas", "observações_técnicas"],
  crop_id: ["crop_id", "cultura_id", "id_cultura"],
  is_active: ["is_active", "ativo"],
};
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

function mapAiError(error: unknown): { status: number; error: string; code: string } {
  const e = error as OpenAIError;
  const message = e?.message || "Falha ao gerar sugestão por IA.";
  const status = e?.status;
  const code = e?.code;

  if (message.includes("OPENAI_API_KEY") || message.includes("OPENAI_CHAT_MODEL")) return { status: 503, error: "Configuração de IA ausente ou inválida no servidor.", code: "ai_configuration_error" };
  if (status === 401 || code === "invalid_api_key") return { status: 502, error: "Falha de autenticação com o provedor de IA.", code: "ai_auth_error" };
  if (status === 403) return { status: 502, error: "Acesso negado pelo provedor de IA para este modelo/chave.", code: "ai_forbidden" };
  if (status === 404 || code === "model_not_found") return { status: 502, error: "Modelo de IA configurado não encontrado ou indisponível.", code: "ai_model_not_found" };
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") return { status: 429, error: "Limite de uso da IA atingido no momento. Tente novamente em instantes.", code: "ai_rate_limit" };
  if (status === 400 || code === "unsupported_parameter" || code === "invalid_request_error") return { status: 502, error: "A requisição enviada ao modelo de IA é incompatível com o modelo configurado.", code: "ai_invalid_request" };
  if (status && status >= 500) return { status: 502, error: "Serviço de IA temporariamente indisponível.", code: "ai_provider_unavailable" };
  if (message.includes("JSON válido")) return { status: 422, error: "A IA retornou dados em formato inválido para preenchimento automático.", code: "ai_invalid_json" };
  return { status: 500, error: "Não foi possível gerar a sugestão com IA agora. Tente novamente em instantes.", code: "ai_unknown_error" };
}

function parseAiPayload(raw: unknown) {
  if (isRecord(raw)) return raw;
  if (typeof raw === "string") return parseJsonObject<Record<string, unknown>>(raw);
  throw new Error("A IA não retornou um objeto JSON válido.");
}

function normalizeDiseaseSuggestion(raw: Record<string, unknown>, fallbackName: string, validCropIds: Set<string>) {
  const pick = (field: keyof DiseaseAiSuggestion): unknown => {
    for (const key of diseaseFieldAliases[field]) {
      if (key in raw) return raw[key];
    }
    return undefined;
  };

  const cropId = cleanText(pick("crop_id"));
  const normalizedCropId = cropId && requireUuid(cropId) && validCropIds.has(cropId) ? cropId : null;
  const invalidCropId = typeof pick("crop_id") === "string" && String(pick("crop_id")).trim() && !normalizedCropId;

  const normalizedField = (field: keyof DiseaseAiSuggestion, fallback = "") => {
    const value = normalizeNullable(pick(field));
    return value || fallback;
  };

  const suggestion: DiseaseAiSuggestion = {
    common_name: normalizedField("common_name", fallbackName),
    scientific_name: normalizedField("scientific_name", diseaseFieldFallback),
    causal_agent: normalizedField("causal_agent", diseaseFieldFallback),
    disease_type: normalizedField("disease_type", diseaseFieldFallback),
    symptoms: normalizedField("symptoms", diseaseFieldFallback),
    favorable_conditions: normalizedField("favorable_conditions", diseaseFieldFallback),
    crop_stage: normalizedField("crop_stage", diseaseFieldFallback),
    severity_level: normalizedField("severity_level", diseaseFieldFallback),
    management_recommendations: normalizedField("management_recommendations", diseaseFieldFallback),
    preventive_control: normalizedField("preventive_control", diseaseFieldFallback),
    curative_control: normalizedField("curative_control", "Validar manejo curativo com receituário agronômico, legislação local, bula e registro para a cultura."),
    technical_notes: normalizedField("technical_notes"),
    crop_id: normalizedCropId,
    is_active: normalizeBoolean(pick("is_active"), true),
  };

  const warnings: string[] = [];
  if (invalidCropId) warnings.push("crop_id inválido foi descartado e substituído por null.");
  if (!suggestion.symptoms || suggestion.symptoms === diseaseFieldFallback) warnings.push("Campo de sintomas foi preenchido com orientação prudente por falta de confirmação.");
  if (!suggestion.management_recommendations || suggestion.management_recommendations === diseaseFieldFallback) warnings.push("Campo de manejo preventivo foi preenchido com orientação prudente por falta de confirmação.");

  return { suggestion, warnings };
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
      : `Pesquise/estime informações técnicas agronômicas para a doença "${name}" e retorne EXCLUSIVAMENTE JSON válido.
Retorne somente um objeto JSON puro, sem markdown, sem comentários e sem texto fora do JSON.
Use exatamente esta estrutura:
{
  "resposta_textual": "",
  "dados": {
    "nome_comum": "",
    "nome_cientifico": "",
    "agente_causal": "",
    "tipo_agente": "",
    "sintomas_principais": "",
    "condicoes_favoraveis": "",
    "periodo_critico_ocorrencia": "",
    "nivel_severidade": "",
    "manejo_preventivo": "",
    "controle_biologico_preventivo": "",
    "manejo_curativo_quimico": ""
  }
}
Regras obrigatórias:
- Não incluir campo cultura, crop_id ou qualquer campo adicional dentro de dados.
- Não retornar arrays, tabelas, markdown, bloco de código ou explicações fora do JSON.
- Preencher todos os campos; se houver incerteza use: "${diseaseFieldFallback}".
- Em resposta_textual, escreva um resumo amigável e curto para o usuário.
- Em manejo_curativo_quimico, inclua ressalva para validação com receituário agronômico, legislação local, bula e registro para a cultura.
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

      const response: AiFillResponse<typeof suggestion> = {
        message: `Encontrei uma sugestão inicial para a cultura "${name}". Revise os campos antes de salvar.`,
        suggestion,
      };
      return NextResponse.json(response);
    }

    const aiObject = isRecord(raw.dados) ? raw.dados : raw;
    const assistantMessage = cleanText(raw.resposta_textual) || cleanText(raw.mensagem) || null;
    const { suggestion, warnings } = normalizeDiseaseSuggestion(aiObject as Record<string, unknown>, name, validCropIds);

    if (!suggestion.common_name) {
      return NextResponse.json({ error: "A IA respondeu, mas não trouxe o campo obrigatório da doença (common_name)." }, { status: 422 });
    }

    const response: AiFillResponse<typeof suggestion> = {
      message: `Montei uma sugestão técnica para a doença "${name}". Revise e ajuste conforme contexto local.`,
      assistant_message: assistantMessage ?? undefined,
      suggestion,
      warnings,
    };
    return NextResponse.json(response);
  } catch (e) {
    const mapped = mapAiError(e);
    const detail = e instanceof Error ? e.message : "Falha ao gerar sugestão por IA.";
    console.error("[specialist/ai-fill] Falha ao gerar sugestão", {
      type: "ai_fill",
      status: (e as OpenAIError)?.status,
      code: (e as OpenAIError)?.code,
      detail
    });
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
}

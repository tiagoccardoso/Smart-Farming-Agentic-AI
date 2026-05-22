import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import type { UserRole } from "../../../../lib/auth";
import { openAIProvider } from "../../../../src/lib/ai/providers/openai";
import { geminiProvider } from "../../../../src/lib/ai/providers/gemini";
import { parseJsonObject } from "../../../../src/lib/ai/utils/json-parser";
import { requireUuid } from "../../../../lib/server/uuid";

type Profile = { id: string; role: UserRole; status?: "active" | "inactive" | null };
type FillType = "crop" | "disease";
type ChatTurn = { role: "user" | "assistant"; content: string };
type AiFillResponse<T> = { message: string; suggestion: T; assistant_message?: string; warnings?: string[]; has_usable_data?: boolean };
type DiseaseAiApiResponse = { success: true; summary: string; data: { nome_comum: string; nome_cientifico: string; agente_causal: string; tipo_agente: string; sintomas_principais: string; condicoes_favoraveis: string; periodo_critico_ocorrencia: string; nivel_severidade: string; manejo_preventivo: string; controle_biologico_preventivo: string; manejo_curativo_quimico: string; observacoes_tecnicas?: string; }; debug?: { warnings?: string[]; raw_text?: string } } | { success: false; error: string; details?: string };
type AiFillErrorStage = "provider_call" | "parse_json" | "fallback_extract" | "normalize" | "unknown";
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

const diseaseOutputFields: Array<keyof DiseaseAiSuggestion> = [
  "common_name",
  "scientific_name",
  "causal_agent",
  "disease_type",
  "symptoms",
  "favorable_conditions",
  "crop_stage",
  "severity_level",
  "management_recommendations",
  "preventive_control",
  "curative_control",
  "technical_notes",
];

const diseaseRequiredFields: Array<keyof DiseaseAiSuggestion> = [
  "common_name",
  "scientific_name",
  "causal_agent",
  "disease_type",
  "symptoms",
  "favorable_conditions",
  "crop_stage",
  "severity_level",
  "management_recommendations",
  "preventive_control",
  "curative_control",
];

const diseaseFieldFallback = "";

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

type AiParseResult = {
  payload: Record<string, unknown>;
  source: "object" | "json_string" | "json_block";
};

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
  if (code === "ABORT_ERR" || message.toLowerCase().includes("aborted")) return { status: 504, error: "Tempo limite excedido ao consultar o serviço de IA.", code: "ai_timeout" };
  if (status === 400 || code === "unsupported_parameter" || code === "invalid_request_error") return { status: 502, error: "A requisição enviada ao modelo de IA é incompatível com o modelo configurado.", code: "ai_invalid_request" };
  if (status && status >= 500) return { status: 502, error: "Serviço de IA temporariamente indisponível.", code: "ai_provider_unavailable" };
  if (message.includes("JSON válido")) return { status: 422, error: "A IA retornou dados em formato inválido para preenchimento automático.", code: "ai_invalid_json" };
  return { status: 500, error: "Não foi possível gerar a sugestão com IA agora. Tente novamente em instantes.", code: "ai_unknown_error" };
}

function extractJsonObjectFromText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("A IA retornou resposta vazia.");
  try {
    return { payload: parseJsonObject<Record<string, unknown>>(trimmed), source: "json_string" as const };
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return { payload: parseJsonObject<Record<string, unknown>>(fenced[1]), source: "json_block" as const };
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return { payload: parseJsonObject<Record<string, unknown>>(trimmed.slice(first, last + 1)), source: "json_block" as const };
  }

  throw new Error("A IA retornou dados em formato inválido para preenchimento automático.");
}

function parseAiPayload(raw: unknown): AiParseResult {
  if (isRecord(raw)) return { payload: raw, source: "object" };
  if (typeof raw === "string") return extractJsonObjectFromText(raw);
  throw new Error("A IA não retornou um objeto JSON válido.");
}

function stripMarkdownFence(value: string) {
  return value.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function extractAssistantMessage(rawText: string) {
  const cleaned = stripMarkdownFence(rawText);
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart < 0) return cleaned.trim();
  return cleaned.slice(0, jsonStart).trim();
}

function extractFallbackFieldsFromText(rawText: string) {
  const text = stripMarkdownFence(rawText);
  const result: Record<string, string> = {};
  const labelMap: Array<[keyof DiseaseAiSuggestion, RegExp]> = [
    ["common_name", /(?:nome\s*comum|doen[çc]a)\s*[:\-]\s*(.+)/i],
    ["scientific_name", /nome\s*cient[íi]fico\s*[:\-]\s*(.+)/i],
    ["causal_agent", /agente\s*causal\s*[:\-]\s*(.+)/i],
    ["disease_type", /tipo\s*(?:de\s*)?agente\s*[:\-]\s*(.+)/i],
    ["symptoms", /sintomas\s*(?:principais)?\s*[:\-]\s*(.+)/i],
    ["favorable_conditions", /condi[çc][õo]es\s*favor[áa]veis\s*[:\-]\s*(.+)/i],
    ["crop_stage", /per[íi]odo\s*cr[íi]tico(?:\s*de\s*ocorr[êe]ncia)?\s*[:\-]\s*(.+)/i],
    ["severity_level", /n[íi]vel\s*de\s*severidade\s*[:\-]\s*(.+)/i],
    ["management_recommendations", /manejo\s*preventivo\s*[:\-]\s*(.+)/i],
    ["preventive_control", /controle\s*biol[óo]gico\s*\/?\s*preventivo\s*[:\-]\s*(.+)/i],
    ["curative_control", /manejo\s*curativo\s*\/?\s*qu[íi]mico\s*[:\-]\s*(.+)/i],
  ];

  for (const [key, pattern] of labelMap) {
    const match = text.match(pattern);
    if (match?.[1]) result[key] = match[1].trim();
  }

  return result;
}

function hasUsefulDiseaseData(suggestion: DiseaseAiSuggestion) {
  return diseaseOutputFields.some((field) => {
    if (field === "is_active" || field === "crop_id") return false;
    return typeof suggestion[field] === "string" && suggestion[field].trim().length > 0;
  });
}

function countStructuredDiseaseFields(payload: DiseaseAiSuggestion) {
  return diseaseRequiredFields.reduce((acc, field) => {
    if (String(payload[field] ?? "").trim().length > 0) return acc + 1;
    return acc;
  }, 0);
}

function hasDiseaseShape(value: unknown) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.some((key) =>
    diseaseRequiredFields.some((field) => diseaseFieldAliases[field].includes(key)),
  );
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
    severity_level: normalizeSeverityLevel(normalizedField("severity_level", diseaseFieldFallback)),
    management_recommendations: normalizedField("management_recommendations", diseaseFieldFallback),
    preventive_control: normalizedField("preventive_control", diseaseFieldFallback),
    curative_control: normalizedField("curative_control", "Validar manejo curativo com receituário agronômico, legislação local, bula e registro para a cultura."),
    technical_notes: normalizedField("technical_notes"),
    crop_id: normalizedCropId,
    is_active: normalizeBoolean(pick("is_active"), true),
  };

  const warnings: string[] = [];
  if (invalidCropId) warnings.push("crop_id inválido foi descartado e substituído por null.");

  const keyFields = diseaseRequiredFields
    .filter((field) => field !== "common_name")
    .map((field) => suggestion[field])
    .filter((value) => typeof value === "string" && value.trim().length > 0);

  if (keyFields.length < 3) {
    warnings.push("A IA retornou poucos campos preenchidos. Revise e complemente manualmente.");
  }

  return { suggestion, warnings };
}

function normalizeSeverityLevel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (["baixo", "baixa", "low", "leve", "mild"].includes(normalized)) return "baixo";
  if (["medio", "médio", "moderado", "medium", "moderate"].includes(normalized)) return "médio";
  if (["alto", "alta", "severo", "severa", "high", "grave", "severe"].includes(normalized)) return "alto";
  return value.trim();
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function adminCfgOrNull() {
  const c = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { ...c, anonKey: key };
}

async function ensureSpecialist(token: string) {
  const user = await getAuthenticatedUser(token);
  const rows = await supabaseRequest<Profile[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`, { method: "GET" }, token);
  const p = rows[0];
  if (!p || !["admin", "specialist"].includes(p.role) || (p.status ?? "active") !== "active") return { error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }) };
  return { user };
}


async function generateTextWithFallback(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { maxOutputTokens: number; promptType: string },
) {
  try {
    return await openAIProvider.generateText(messages, options);
  } catch (openAiErr) {
    try {
      return await geminiProvider.generateText(messages, options);
    } catch {
      throw openAiErr;
    }
  }
}

async function enrichDiseaseSuggestion(name: string, suggestion: DiseaseAiSuggestion) {
  const missing = diseaseRequiredFields.filter((field) => !String(suggestion[field] ?? "").trim());
  if (missing.length === 0) return { suggestion, warnings: [] as string[] };

  const completionPrompt = `Você é um especialista em fitopatologia. Complete SOMENTE os campos ausentes do JSON abaixo com conteúdo técnico em português do Brasil.
Retorne APENAS JSON válido sem markdown, sem comentários e sem texto adicional.
Não inclua chaves extras. Não inclua crop_id.

Doença: "${name}"
Campos ausentes: ${missing.join(", ")}

JSON atual:
${JSON.stringify(suggestion, null, 2)}`;

  const completion = await generateTextWithFallback(
    [
      { role: "system", content: "Você retorna somente JSON válido e técnico para cadastro agrícola." },
      { role: "user", content: completionPrompt },
    ],
    { maxOutputTokens: 1500, promptType: "specialist_catalog_fill" },
  );

  const parsed = parseAiPayload(completion.content);
  const completionData = parsed.payload;
  const { suggestion: normalizedCompletion } = normalizeDiseaseSuggestion(completionData, name, new Set());

  const merged: DiseaseAiSuggestion = { ...suggestion };
  for (const field of missing) {
    const value = String(normalizedCompletion[field] ?? "").trim();
    if (value) merged[field] = value as never;
  }

  return { suggestion: merged, warnings: ["Sugestão parcialmente complementada por segunda etapa de IA."] };
}

export async function POST(request: NextRequest) {
  let errorStage: AiFillErrorStage = "unknown";
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Faça login." }, { status: 401 });
    const auth = await ensureSpecialist(token);
    if (auth.error) return auth.error;

    const payload = (await request.json().catch(() => null)) as { type?: FillType; name?: string; history?: ChatTurn[] } | null;
    const type = payload?.type;
    const name = payload?.name?.trim();
    const history = Array.isArray(payload?.history)
      ? payload.history.filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim())
      : [];
    if (!type || !name) return NextResponse.json({ error: "Informe tipo e nome." }, { status: 400 });

    const validCropIds = new Set<string>();
    if (type === "disease") {
      const cfg = adminCfgOrNull();
      const crops = await supabaseRequest<Array<{ id: string; display_name_pt: string | null; name: string }>>(
        "/rest/v1/crops?select=id,name,display_name_pt&active=eq.true&order=display_name_pt.asc",
        { method: "GET" },
        cfg?.anonKey ?? token,
        cfg ?? undefined,
      );
      crops.forEach((crop) => validCropIds.add(crop.id));
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
      : `Pesquise informações técnicas agronômicas confiáveis sobre a doença: "${name}".

Objetivo:
Gerar informações para preencher automaticamente um cadastro de doenças agrícolas.

Regras obrigatórias:
- Responda em português do Brasil.
- Não invente dados incertos.
- Quando a informação variar conforme a cultura, informe isso claramente.
- Preencha todos os campos sempre que houver informação técnica confiável.
- Não deixe campos vazios quando a informação puder ser inferida com segurança técnica.
- Não inclua crop_id.
- Considere possíveis variações do nome informado pelo usuário. Exemplo: se o usuário digitar "Antraquinose", considere que pode estar se referindo a "Antracnose".
- Priorize informações agronômicas técnicas, como agente causal, sintomas, condições favoráveis e manejo.
- O manejo químico deve sempre conter ressalva para validação com engenheiro agrônomo, receituário agronômico, legislação local, bula e registro do produto para a cultura.

Formato obrigatório da resposta:
Responda em DUAS PARTES.

PARTE 1:
Um resumo textual curto, objetivo e técnico sobre a doença.

PARTE 2:
Um JSON válido, sem comentários, sem markdown dentro do JSON, seguindo exatamente este formato:

{
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
  "manejo_curativo_quimico": "",
  "observacoes_tecnicas": ""
}

Instruções para preenchimento:
- nome_comum: nome popular mais usado da doença.
- nome_cientifico: nome científico do patógeno ou grupo de patógenos, quando aplicável.
- agente_causal: detalhe do organismo causador.
- tipo_agente: Fungo, Bactéria, Vírus, Nematoide, Fisiológico, Praga ou outro tipo aplicável.
- sintomas_principais: sintomas visíveis no campo.
- condicoes_favoraveis: clima, umidade, temperatura, manejo ou ambiente que favorecem a doença.
- periodo_critico_ocorrencia: fase da cultura ou época de maior risco.
- nivel_severidade: Baixa, Média ou Alta, com justificativa curta.
- manejo_preventivo: medidas culturais, sanitárias e preventivas.
- controle_biologico_preventivo: opções biológicas/preventivas quando existirem; se depender da cultura, informe.
- manejo_curativo_quimico: opções gerais de controle químico apenas quando tecnicamente aplicável, sempre com ressalva obrigatória sobre validação com receituário agronômico, legislação local, bula e registro para a cultura.
- observacoes_tecnicas: notas adicionais, variações regionais, resistência a fungicidas, alertas técnicos relevantes ou referências normativas (pode ficar vazio se não houver informação técnica adicional relevante).

Doença pesquisada: "${name}"`;

    errorStage = "provider_call";
    const messages = [
      {
        role: "system" as const,
        content:
          "Você é um assistente de cadastro técnico agrícola. Responda de forma objetiva em português do Brasil e inclua um JSON válido com os campos solicitados.",
      },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: prompt },
    ];
    const result = await generateTextWithFallback(
      messages,
      { maxOutputTokens: 2500, promptType: "specialist_catalog_fill" },
    );

    let raw: Record<string, unknown> = {};
    let parsedSource: AiParseResult["source"] | "text_only" = "text_only";
    let rawTextResponse = typeof result.content === "string" ? result.content : "";

    try {
      errorStage = "parse_json";
      const parsed = parseAiPayload(result.content);
      raw = parsed.payload;
      parsedSource = parsed.source;
    } catch {
      errorStage = "fallback_extract";
      raw = extractFallbackFieldsFromText(rawTextResponse);
    }

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

    errorStage = "normalize";
    const aiObjectCandidate = isRecord(raw.dados) ? raw.dados : raw;
    if (process.env.NODE_ENV !== "production") console.info("[specialist/ai-fill] parse source", parsedSource);
    const aiObject = hasDiseaseShape(aiObjectCandidate)
      ? (aiObjectCandidate as Record<string, unknown>)
      : {
          ...extractFallbackFieldsFromText(rawTextResponse),
          ...(isRecord(aiObjectCandidate) ? aiObjectCandidate : {}),
        };
    const assistantMessage = cleanText(raw.resposta_textual) || cleanText(raw.mensagem) || cleanText(extractAssistantMessage(rawTextResponse)) || null;
    let { suggestion, warnings } = normalizeDiseaseSuggestion(aiObject, name, validCropIds);

    if (countStructuredDiseaseFields(suggestion) < diseaseRequiredFields.length) {
      try {
        const enriched = await enrichDiseaseSuggestion(name, suggestion);
        suggestion = enriched.suggestion;
        warnings = [...warnings, ...enriched.warnings];
      } catch {
        warnings = [...warnings, "Não foi possível complementar automaticamente todos os campos ausentes."];
      }
    }

    const hasUsableData = hasUsefulDiseaseData(suggestion);
    if (!hasUsableData) {
      return NextResponse.json({
        success: false,
        error: "A IA respondeu, mas não trouxe informações úteis para preenchimento automático. Você pode tentar outra descrição e preencher manualmente.",
        details: "ai_no_usable_data",
        debug: { raw_text: rawTextResponse || undefined, warnings }
      }, { status: 422 });
    }

    const response: DiseaseAiApiResponse = {
      success: true,
      summary: assistantMessage || `Resumo técnico gerado para ${name}. Revise e ajuste conforme o contexto local.`,
      data: {
        nome_comum: suggestion.common_name,
        nome_cientifico: suggestion.scientific_name,
        agente_causal: suggestion.causal_agent,
        tipo_agente: suggestion.disease_type,
        sintomas_principais: suggestion.symptoms,
        condicoes_favoraveis: suggestion.favorable_conditions,
        periodo_critico_ocorrencia: suggestion.crop_stage,
        nivel_severidade: suggestion.severity_level,
        manejo_preventivo: suggestion.management_recommendations,
        controle_biologico_preventivo: suggestion.preventive_control,
        manejo_curativo_quimico: suggestion.curative_control,
        observacoes_tecnicas: suggestion.technical_notes || undefined,
      },
      debug: {
        warnings: [...warnings, `Campos estruturados preenchidos: ${countStructuredDiseaseFields(suggestion)}/${diseaseRequiredFields.length}`],
        raw_text: rawTextResponse || undefined
      }
    };
    return NextResponse.json(response);
  } catch (e) {
    const mapped = mapAiError(e);
    const detail = e instanceof Error ? e.message : "Falha ao gerar sugestão por IA.";
    console.error("[specialist/ai-fill] Falha ao gerar sugestão", {
      type: "ai_fill",
      status: (e as OpenAIError)?.status,
      code: (e as OpenAIError)?.code,
      detail,
      errorStage
    });
    return NextResponse.json({ success: false, error: mapped.error, details: `${mapped.code}:${errorStage}` }, { status: mapped.status });
  }
}

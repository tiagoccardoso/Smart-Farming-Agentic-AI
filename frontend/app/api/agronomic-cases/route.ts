import { NextRequest, NextResponse } from "next/server";
import {
  PlanFeatureUnavailableError,
  assertPlanFeature,
  getPlanLimitCheck,
} from "../../../lib/billing/check-plan-limits";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

type SupabaseConfig = { supabaseUrl: string; anonKey: string };
type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "PLAN_LIMIT_REACHED"
  | "SERVER_CONFIGURATION_ERROR"
  | "DATABASE_SAVE_FAILED"
  | "DATABASE_PERMISSION_DENIED"
  | "UPLOAD_FAILED"
  | "UNKNOWN_ERROR";

type ErrorResponseBody = {
  error: string;
  code: ApiErrorCode;
  fieldErrors?: Record<string, string>;
};

type SupabaseErrorPayload = {
  message?: string;
  error_description?: string;
  error?: string | { message?: string };
  code?: string;
  details?: string;
  hint?: string;
};

class FriendlyRequestError extends Error {
  status: number;
  code: ApiErrorCode;
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status = 400,
    code: ApiErrorCode = "VALIDATION_ERROR",
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "FriendlyRequestError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

class ConfigurationError extends Error {
  status = 500;
  code: ApiErrorCode = "SERVER_CONFIGURATION_ERROR";

  constructor(
    message = "Configuração de Supabase ausente para criação de casos.",
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

class SupabaseRequestError extends Error {
  status: number;
  supabaseCode?: string;
  details?: string;
  hint?: string;

  constructor(
    status: number,
    payload: SupabaseErrorPayload | null,
    fallbackMessage: string,
  ) {
    const payloadMessage = getPayloadMessage(payload);
    super(payloadMessage || fallbackMessage);
    this.name = "SupabaseRequestError";
    this.status = status;
    this.supabaseCode = payload?.code;
    this.details = payload?.details;
    this.hint = payload?.hint;
  }
}

function getPayloadMessage(payload: SupabaseErrorPayload | null) {
  if (!payload) return "";
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error_description === "string")
    return payload.error_description;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.error?.message === "string") return payload.error.message;
  return "";
}

function parseJsonSafely(text: string): SupabaseErrorPayload | null {
  if (!text) return null;

  try {
    return JSON.parse(text) as SupabaseErrorPayload;
  } catch {
    return null;
  }
}

function includesAny(value: string | undefined, patterns: RegExp[]) {
  return Boolean(value && patterns.some((pattern) => pattern.test(value)));
}

function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new ConfigurationError();
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  const value = requiredText(formData, key);
  return value.length > 0 ? value : null;
}

function optionalNumber(formData: FormData, key: string, label: string) {
  const rawValue = requiredText(formData, key);
  const value = rawValue.replace(",", ".");

  if (!value) {
    return null;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new FriendlyRequestError(
      `${label} deve ser um número maior que zero.`,
      400,
      "VALIDATION_ERROR",
      {
        [key]: `${label} deve ser um número maior que zero.`,
      },
    );
  }

  return numberValue;
}

function sanitizeFileName(fileName: string) {
  const sanitized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitized || "arquivo";
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateUploadFile(
  file: File,
  allowedTypes: string[],
  allowedExtensions: string[],
  label: string,
) {
  const extension = getFileExtension(file.name);

  if (
    !allowedTypes.includes(file.type) ||
    !allowedExtensions.includes(extension)
  ) {
    throw new FriendlyRequestError(
      `${label} "${file.name}" não está em um formato aceito.`,
      400,
      "VALIDATION_ERROR",
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FriendlyRequestError(
      `${label} "${file.name}" excede o limite de 10MB.`,
      400,
      "VALIDATION_ERROR",
    );
  }
}

function buildNullableTextFilter(column: string, value: string | null) {
  return value
    ? `${column}=eq.${encodeURIComponent(value)}`
    : `${column}=is.null`;
}

function buildStoredFilePath(
  userId: string,
  caseId: string,
  fileName: string,
  index: number,
) {
  return `${userId}/${caseId}/${Date.now()}-${index}-${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit,
  token: string,
  config: SupabaseConfig,
) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    throw new SupabaseRequestError(
      response.status,
      payload,
      "Erro ao comunicar com o banco de dados.",
    );
  }

  return payload as T;
}

async function uploadToStorage(
  file: File,
  path: string,
  token: string,
  config: SupabaseConfig,
) {
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: Buffer.from(await file.arrayBuffer()),
      cache: "no-store",
    },
  );

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Falha no upload de anexo do caso agronômico.", {
        status: response.status,
        code: payload?.code,
        message: getPayloadMessage(payload),
        details: payload?.details,
      });
    }

    if (response.status === 409) {
      throw new FriendlyRequestError(
        `Já existe um arquivo chamado ${file.name} neste caso. Renomeie o arquivo e tente novamente.`,
        409,
        "UPLOAD_FAILED",
      );
    }

    if (response.status === 401) {
      throw new FriendlyRequestError(
        "Sua sessão expirou durante o upload. Faça login novamente e tente enviar o caso.",
        401,
        "AUTH_REQUIRED",
      );
    }

    if (response.status === 403 || payload?.code === "42501") {
      throw new FriendlyRequestError(
        "Não foi possível anexar o arquivo por falta de permissão no storage.",
        403,
        "DATABASE_PERMISSION_DENIED",
      );
    }

    throw new FriendlyRequestError(
      `Não foi possível anexar o arquivo "${file.name}". Tente novamente em instantes.`,
      response.status >= 500 ? 502 : 400,
      "UPLOAD_FAILED",
    );
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function getAuthenticatedUser(token: string, config: SupabaseConfig) {
  return supabaseRequest<{ id: string }>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config,
  );
}

function toErrorResponse(error: unknown): {
  body: ErrorResponseBody;
  status: number;
} {
  if (error instanceof FriendlyRequestError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      },
    };
  }

  if (error instanceof ConfigurationError) {
    return {
      status: error.status,
      body: {
        error:
          "Serviço de envio de casos indisponível por configuração do servidor. Avise o suporte.",
        code: error.code,
      },
    };
  }

  if (error instanceof SupabaseRequestError) {
    const databaseMessage = [error.message, error.details, error.hint]
      .filter(Boolean)
      .join(" ");

    if (error.status === 401) {
      return {
        status: 401,
        body: {
          error: "Sua sessão expirou. Faça login novamente para enviar o caso.",
          code: "AUTH_REQUIRED",
        },
      };
    }

    if (
      error.status === 403 ||
      error.supabaseCode === "42501" ||
      includesAny(databaseMessage, [/row-level security/i, /permission denied/i])
    ) {
      return {
        status: 403,
        body: {
          error:
            "Você não tem permissão para salvar este caso. Verifique sua sessão e as permissões da conta.",
          code: "DATABASE_PERMISSION_DENIED",
        },
      };
    }

    if (
      includesAny(databaseMessage, [
        /relation .* does not exist/i,
        /column .* does not exist/i,
        /schema cache/i,
      ])
    ) {
      return {
        status: 500,
        body: {
          error:
            "A estrutura do banco de dados não está compatível com o envio de casos. Avise o suporte para revisar as migrations.",
          code: "SERVER_CONFIGURATION_ERROR",
        },
      };
    }

    if (error.supabaseCode === "23505") {
      return {
        status: 409,
        body: {
          error:
            "Já existe um registro com essas informações. Revise os dados e tente novamente.",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (error.supabaseCode === "23502") {
      return {
        status: 400,
        body: {
          error: "Há um campo obrigatório ausente no cadastro do caso.",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (error.supabaseCode === "23503") {
      return {
        status: 400,
        body: {
          error:
            "Não foi possível relacionar o caso ao usuário ou à propriedade informada.",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (error.supabaseCode === "23514") {
      return {
        status: 400,
        body: {
          error:
            "Algum valor enviado não é aceito pelas regras do banco de dados.",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (error.supabaseCode === "22P02") {
      return {
        status: 400,
        body: {
          error: "Foi enviado um identificador ou número em formato inválido.",
          code: "VALIDATION_ERROR",
        },
      };
    }

    return {
      status: error.status >= 500 ? 502 : error.status,
      body: {
        error:
          "Falha ao salvar o caso no banco de dados. Tente novamente em instantes.",
        code: "DATABASE_SAVE_FAILED",
      },
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : "Erro desconhecido ao salvar o caso.";

  if (/SUPABASE|NEXT_PUBLIC|SERVICE_ROLE|secret|token|apikey/i.test(message)) {
    return {
      status: 500,
      body: {
        error:
          "Serviço de envio de casos indisponível por configuração do servidor. Avise o suporte.",
        code: "SERVER_CONFIGURATION_ERROR",
      },
    };
  }

  return {
    status: 500,
    body: {
      error:
        "Não foi possível salvar o caso agronômico. Tente novamente em instantes.",
      code: "UNKNOWN_ERROR",
    },
  };
}

function logServerError(context: string, error: unknown) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      context,
      error instanceof Error
        ? { name: error.name, message: error.message }
        : error,
    );
    return;
  }

  console.error(context, error);
}

type ListedCaseRow = {
  id: string;
  user_id: string | null;
  crop: string;
  growth_stage: string | null;
  symptoms: string;
  history: string | null;
  soil_analysis_url: string | null;
  status: string | null;
  risk_level: string | null;
  ai_summary: string | null;
  ai_recommendation: string | null;
  ai_analysis_json?: unknown | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  created_at: string | null;
  updated_at?: string | null;
  farm_id: string | null;
};

type ListedFarm = {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  area_hectares: number | null;
  soil_type: string | null;
};

type ListedHumanReview = {
  id: string;
  case_id: string;
  status: string | null;
  review_text: string | null;
  technical_recommendation: string | null;
  final_observations: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

type ListedReport = {
  id: string;
  case_id: string;
  report_url: string | null;
  report_type: string | null;
  created_at: string | null;
};

type ListedOneTimeOrder = {
  id: string;
  case_id: string | null;
  service_type: string | null;
  price_cents: number | null;
  payment_status: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function buildInFilter(values: string[]) {
  return `in.(${values.map(encodeURIComponent).join(",")})`;
}

export async function GET(request: NextRequest) {
  try {
    const config = getSupabaseConfig();
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para consultar seus casos agronômicos." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token, config);
    const { searchParams } = request.nextUrl;
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") ?? "50") || 50),
    );
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const offset = (page - 1) * limit;
    const scope = searchParams.get("scope");
    const statusFilter =
      scope === "human_review"
        ? "&human_review_requested=eq.true"
        : scope === "ai_analyzed"
          ? "&or=(status.eq.ai_analyzed,ai_summary.not.is.null)"
          : "";
    const cases = await supabaseRequest<ListedCaseRow[]>(
      `/rest/v1/agronomic_cases?user_id=eq.${encodeURIComponent(user.id)}&deleted_at=is.null${statusFilter}&select=id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,ai_analysis_json,human_review_requested,human_review_status,created_at,updated_at,farm_id&order=updated_at.desc&limit=${limit}&offset=${offset}`,
      { method: "GET" },
      token,
      config,
    );

    if (cases.length === 0) {
      const planCheck = await getPlanLimitCheck(user.id, "case_analysis").catch(
        () => null,
      );
      return NextResponse.json({
        cases: [],
        pagination: { page, limit, hasMore: false },
        plan: planCheck
          ? {
              slug:
                planCheck.planSlug === "ia-revisao-humana"
                  ? "premium"
                  : planCheck.planSlug,
              label:
                planCheck.planSlug === "ia-revisao-humana"
                  ? "Premium"
                  : planCheck.planLabel.replace("Plano ", ""),
              remaining: planCheck.remaining,
              subscriptionStatus:
                planCheck.planSlug === "gratuito"
                  ? "Sem assinatura ativa"
                  : "Assinatura ativa",
            }
          : undefined,
      });
    }

    const farmIds = Array.from(
      new Set(
        cases
          .map((caseItem) => caseItem.farm_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const caseIds = cases.map((caseItem) => caseItem.id);

    const [farms, humanReviews, reports, orders] = await Promise.all([
      farmIds.length > 0
        ? supabaseRequest<ListedFarm[]>(
            `/rest/v1/farms?id=${buildInFilter(farmIds)}&select=id,name,city,state,area_hectares,soil_type`,
            { method: "GET" },
            token,
            config,
          )
        : Promise.resolve([]),
      supabaseRequest<ListedHumanReview[]>(
        `/rest/v1/human_reviews?case_id=${buildInFilter(caseIds)}&select=id,case_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config,
      ),
      supabaseRequest<ListedReport[]>(
        `/rest/v1/reports?case_id=${buildInFilter(caseIds)}&select=id,case_id,report_url,report_type,created_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config,
      ),
      supabaseRequest<ListedOneTimeOrder[]>(
        `/rest/v1/one_time_orders?user_id=eq.${encodeURIComponent(user.id)}&case_id=${buildInFilter(caseIds)}&service_type=eq.human_case_review&select=id,case_id,service_type,price_cents,payment_status,stripe_checkout_session_id,created_at,updated_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config,
      ).catch(() => []),
    ]);

    const imageRows = await supabaseRequest<Array<{ case_id: string }>>(
      `/rest/v1/case_images?case_id=${buildInFilter(caseIds)}&select=case_id`,
      { method: "GET" },
      token,
      config,
    ).catch(() => []);
    const imageCounts = imageRows.reduce(
      (acc, row) => acc.set(row.case_id, (acc.get(row.case_id) ?? 0) + 1),
      new Map<string, number>(),
    );
    const planCheck = await getPlanLimitCheck(user.id, "case_analysis").catch(
      () => null,
    );

    const farmsById = new Map(farms.map((farm) => [farm.id, farm]));
    const reviewsByCaseId = new Map<string, ListedHumanReview>();
    const reportsByCaseId = new Map<string, ListedReport>();
    const ordersByCaseId = new Map<string, ListedOneTimeOrder>();

    humanReviews.forEach((review) => {
      if (!reviewsByCaseId.has(review.case_id)) {
        reviewsByCaseId.set(review.case_id, review);
      }
    });

    reports.forEach((report) => {
      if (!reportsByCaseId.has(report.case_id)) {
        reportsByCaseId.set(report.case_id, report);
      }
    });

    orders.forEach((order) => {
      if (order.case_id && !ordersByCaseId.has(order.case_id)) {
        ordersByCaseId.set(order.case_id, order);
      }
    });

    return NextResponse.json({
      cases: cases.map((caseItem) => ({
        ...caseItem,
        farm: caseItem.farm_id
          ? (farmsById.get(caseItem.farm_id) ?? null)
          : null,
        latestHumanReview: reviewsByCaseId.get(caseItem.id) ?? null,
        latestReport: reportsByCaseId.get(caseItem.id) ?? null,
        latestOrder: ordersByCaseId.get(caseItem.id) ?? null,
        payment_status: ordersByCaseId.get(caseItem.id)?.payment_status ?? null,
        review_price_cents:
          ordersByCaseId.get(caseItem.id)?.price_cents ?? null,
        images_count: imageCounts.get(caseItem.id) ?? 0,
      })),
      pagination: { page, limit, hasMore: cases.length === limit },
      plan: planCheck
        ? {
            slug:
              planCheck.planSlug === "ia-revisao-humana"
                ? "premium"
                : planCheck.planSlug,
            label:
              planCheck.planSlug === "ia-revisao-humana"
                ? "Premium"
                : planCheck.planLabel.replace("Plano ", ""),
            remaining: planCheck.remaining,
            subscriptionStatus:
              planCheck.planSlug === "gratuito"
                ? "Sem assinatura ativa"
                : "Assinatura ativa",
          }
        : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar seus casos agronômicos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = getSupabaseConfig();
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json(
        {
          error: "Faça login para enviar um caso agronômico.",
          code: "AUTH_REQUIRED" satisfies ApiErrorCode,
        },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const crop = requiredText(formData, "crop");
    const state = requiredText(formData, "state");
    const symptoms = requiredText(formData, "symptoms");
    const fieldErrors: Record<string, string> = {};

    if (!crop) fieldErrors.crop = "Informe a cultura.";
    if (!state) fieldErrors.state = "Informe o estado.";
    if (!symptoms) fieldErrors.symptoms = "Descreva os sintomas observados.";

    if (Object.keys(fieldErrors).length > 0) {
      throw new FriendlyRequestError(
        "Preencha os campos obrigatórios antes de enviar o caso.",
        400,
        "VALIDATION_ERROR",
        fieldErrors,
      );
    }

    const farmName = optionalText(formData, "farmName");
    const city = optionalText(formData, "city");
    const areaHectares = optionalNumber(
      formData,
      "areaHectares",
      "Área em hectares",
    );
    const soilType = optionalText(formData, "soilType");
    const growthStage = optionalText(formData, "growthStage");
    const managementHistory = optionalText(formData, "managementHistory");
    const photoFiles = formData.getAll("photos").filter(isFile);
    const soilAnalysis = formData.get("soilAnalysis");

    photoFiles.forEach((photo) =>
      validateUploadFile(
        photo,
        ACCEPTED_PHOTO_TYPES,
        ACCEPTED_PHOTO_EXTENSIONS,
        "A imagem",
      ),
    );

    if (isFile(soilAnalysis)) {
      validateUploadFile(
        soilAnalysis,
        ACCEPTED_SOIL_ANALYSIS_TYPES,
        ACCEPTED_SOIL_ANALYSIS_EXTENSIONS,
        "A análise de solo",
      );
    }

    const user = await getAuthenticatedUser(token, config);

    if (!user?.id) {
      throw new FriendlyRequestError(
        "Sua sessão não retornou um usuário válido. Faça login novamente e tente enviar o caso.",
        401,
        "AUTH_REQUIRED",
      );
    }

    if (photoFiles.length > 0) {
      await assertPlanFeature(user.id, "photo_upload");
    }

    if (isFile(soilAnalysis)) {
      await assertPlanFeature(user.id, "soil_analysis_upload");
    }

    const farmPayload = {
      user_id: user.id,
      name: farmName,
      city,
      state,
      area_hectares: areaHectares,
      soil_type: soilType,
    };
    const farmLookupFilter = [
      `user_id=eq.${encodeURIComponent(user.id)}`,
      buildNullableTextFilter("name", farmName),
      buildNullableTextFilter("city", city),
      `state=eq.${encodeURIComponent(state)}`,
      "select=id",
      "limit=1",
    ].join("&");

    const farms = await supabaseRequest<Array<{ id: string }>>(
      `/rest/v1/farms?${farmLookupFilter}`,
      { method: "GET" },
      token,
      config,
    );

    const farm = farms[0]
      ? (
          await supabaseRequest<Array<{ id: string }>>(
            `/rest/v1/farms?id=eq.${encodeURIComponent(farms[0].id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
            {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify(farmPayload),
            },
            token,
            config,
          )
        )[0]
      : (
          await supabaseRequest<Array<{ id: string }>>(
            "/rest/v1/farms?select=id",
            {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify(farmPayload),
            },
            token,
            config,
          )
        )[0];

    if (!farm?.id) {
      throw new FriendlyRequestError(
        "Não foi possível salvar os dados da propriedade. Verifique sua sessão e tente novamente.",
        502,
        "DATABASE_SAVE_FAILED",
      );
    }

    const createdCase = (
      await supabaseRequest<Array<{ id: string }>>(
        "/rest/v1/agronomic_cases?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: user.id,
            farm_id: farm.id,
            crop,
            growth_stage: growthStage,
            symptoms,
            history: managementHistory,
            status: "submitted",
          }),
        },
        token,
        config,
      )
    )[0];

    if (!createdCase?.id) {
      throw new FriendlyRequestError(
        "Não foi possível criar o registro do caso. Verifique as permissões da conta e tente novamente.",
        502,
        "DATABASE_SAVE_FAILED",
      );
    }

    const uploadedImages = [];

    for (const [index, photo] of photoFiles.entries()) {
      const path = buildStoredFilePath(
        user.id,
        createdCase.id,
        photo.name,
        index,
      );
      const imageUrl = await uploadToStorage(photo, path, token, config);
      uploadedImages.push({
        case_id: createdCase.id,
        user_id: user.id,
        image_url: imageUrl,
        image_type: photo.type || "image",
      });
    }

    if (uploadedImages.length > 0) {
      await supabaseRequest(
        "/rest/v1/case_images",
        {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(uploadedImages),
        },
        token,
        config,
      );
    }

    if (isFile(soilAnalysis)) {
      const path = buildStoredFilePath(
        user.id,
        createdCase.id,
        soilAnalysis.name,
        photoFiles.length,
      );
      const soilAnalysisUrl = await uploadToStorage(
        soilAnalysis,
        path,
        token,
        config,
      );

      await supabaseRequest(
        `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(createdCase.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ soil_analysis_url: soilAnalysisUrl }),
        },
        token,
        config,
      );
    }

    return NextResponse.json({
      caseId: createdCase.id,
      message: "Caso salvo e enviado com sucesso.",
    });
  } catch (error) {
    if (error instanceof PlanFeatureUnavailableError) {
      return NextResponse.json(
        {
          error:
            "Seu plano atual não permite enviar fotos ou análise de solo. Remova o anexo para enviar o caso sem imagem ou atualize o plano para continuar com anexos.",
          code: "PLAN_LIMIT_REACHED" satisfies ApiErrorCode,
        },
        { status: error.status },
      );
    }

    logServerError("Erro ao criar caso agronômico", error);
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

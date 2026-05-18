import { NextRequest, NextResponse } from "next/server";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanFeatureUnavailableError, assertPlanFeature, getPlanLimitCheck } from "../../../lib/billing/check-plan-limits";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

class FriendlyRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para salvar casos.");
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

function optionalNumber(formData: FormData, key: string) {
  const value = requiredText(formData, key).replace(",", ".");

  if (!value) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
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

function validateUploadFile(file: File, allowedTypes: string[], allowedExtensions: string[], label: string) {
  const extension = getFileExtension(file.name);

  if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(extension)) {
    throw new FriendlyRequestError(`${label} "${file.name}" não está em um formato aceito.`);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FriendlyRequestError(`${label} "${file.name}" excede o limite de 10MB.`);
  }
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit,
  token: string,
  config: { supabaseUrl: string; anonKey: string }
) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || "Erro ao comunicar com o Supabase. Tente novamente em instantes.");
  }

  return payload as T;
}

async function uploadToStorage(file: File, path: string, token: string, config: { supabaseUrl: string; anonKey: string }) {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: Buffer.from(await file.arrayBuffer()),
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 409) {
      throw new FriendlyRequestError(`Já existe um arquivo chamado ${file.name} neste caso. Renomeie o arquivo e tente novamente.`, 409);
    }

    throw new Error(payload?.message || payload?.error || `Não foi possível enviar o arquivo ${file.name}. Tente novamente.`);
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function getAuthenticatedUser(token: string, config: { supabaseUrl: string; anonKey: string }) {
  return supabaseRequest<{ id: string }>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config
  );
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
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para consultar seus casos agronômicos." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token, config);
    const { searchParams } = request.nextUrl;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50") || 50));
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const offset = (page - 1) * limit;
    const scope = searchParams.get("scope");
    const statusFilter = scope === "human_review"
      ? "&human_review_requested=eq.true"
      : scope === "ai_analyzed"
        ? "&or=(status.eq.ai_analyzed,ai_summary.not.is.null)"
        : "";
    const cases = await supabaseRequest<ListedCaseRow[]>(
      `/rest/v1/agronomic_cases?user_id=eq.${encodeURIComponent(user.id)}&deleted_at=is.null${statusFilter}&select=id,user_id,crop,growth_stage,symptoms,history,soil_analysis_url,status,risk_level,ai_summary,ai_recommendation,ai_analysis_json,human_review_requested,human_review_status,created_at,updated_at,farm_id&order=updated_at.desc&limit=${limit}&offset=${offset}`,
      { method: "GET" },
      token,
      config
    );

    if (cases.length === 0) {
      const planCheck = await getPlanLimitCheck(user.id, "case_analysis").catch(() => null);
      return NextResponse.json({
        cases: [],
        pagination: { page, limit, hasMore: false },
        plan: planCheck ? {
          slug: planCheck.planSlug === "ia-revisao-humana" ? "premium" : planCheck.planSlug,
          label: planCheck.planSlug === "ia-revisao-humana" ? "Premium" : planCheck.planLabel.replace("Plano ", ""),
          remaining: planCheck.remaining,
          subscriptionStatus: planCheck.planSlug === "gratuito" ? "Sem assinatura ativa" : "Assinatura ativa"
        } : undefined
      });
    }

    const farmIds = Array.from(new Set(cases.map((caseItem) => caseItem.farm_id).filter((id): id is string => Boolean(id))));
    const caseIds = cases.map((caseItem) => caseItem.id);

    const [farms, humanReviews, reports, orders] = await Promise.all([
      farmIds.length > 0
        ? supabaseRequest<ListedFarm[]>(
            `/rest/v1/farms?id=${buildInFilter(farmIds)}&select=id,name,city,state,area_hectares,soil_type`,
            { method: "GET" },
            token,
            config
          )
        : Promise.resolve([]),
      supabaseRequest<ListedHumanReview[]>(
        `/rest/v1/human_reviews?case_id=${buildInFilter(caseIds)}&select=id,case_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config
      ),
      supabaseRequest<ListedReport[]>(
        `/rest/v1/reports?case_id=${buildInFilter(caseIds)}&select=id,case_id,report_url,report_type,created_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config
      ),
      supabaseRequest<ListedOneTimeOrder[]>(
        `/rest/v1/one_time_orders?user_id=eq.${encodeURIComponent(user.id)}&case_id=${buildInFilter(caseIds)}&service_type=eq.human_case_review&select=id,case_id,service_type,price_cents,payment_status,stripe_checkout_session_id,created_at,updated_at&order=created_at.desc`,
        { method: "GET" },
        token,
        config
      ).catch(() => [])
    ]);

    const imageRows = await supabaseRequest<Array<{ case_id: string }>>(
      `/rest/v1/case_images?case_id=${buildInFilter(caseIds)}&select=case_id`,
      { method: "GET" },
      token,
      config
    ).catch(() => []);
    const imageCounts = imageRows.reduce((acc, row) => acc.set(row.case_id, (acc.get(row.case_id) ?? 0) + 1), new Map<string, number>());
    const planCheck = await getPlanLimitCheck(user.id, "case_analysis").catch(() => null);

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
        farm: caseItem.farm_id ? farmsById.get(caseItem.farm_id) ?? null : null,
        latestHumanReview: reviewsByCaseId.get(caseItem.id) ?? null,
        latestReport: reportsByCaseId.get(caseItem.id) ?? null,
        latestOrder: ordersByCaseId.get(caseItem.id) ?? null,
        payment_status: ordersByCaseId.get(caseItem.id)?.payment_status ?? null,
        review_price_cents: ordersByCaseId.get(caseItem.id)?.price_cents ?? null,
        images_count: imageCounts.get(caseItem.id) ?? 0
      })),
      pagination: { page, limit, hasMore: cases.length === limit },
      plan: planCheck ? {
        slug: planCheck.planSlug === "ia-revisao-humana" ? "premium" : planCheck.planSlug,
        label: planCheck.planSlug === "ia-revisao-humana" ? "Premium" : planCheck.planLabel.replace("Plano ", ""),
        remaining: planCheck.remaining,
        subscriptionStatus: planCheck.planSlug === "gratuito" ? "Sem assinatura ativa" : "Assinatura ativa"
      } : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar seus casos agronômicos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = getSupabaseConfig();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para enviar um caso agronômico." }, { status: 401 });
    }

    const formData = await request.formData();
    const crop = requiredText(formData, "crop");
    const state = requiredText(formData, "state");
    const symptoms = requiredText(formData, "symptoms");

    if (!crop || !state || !symptoms) {
      return NextResponse.json({ error: "Preencha cultura, estado e sintomas observados." }, { status: 400 });
    }

    const photoFiles = formData.getAll("photos").filter(isFile);
    const soilAnalysis = formData.get("soilAnalysis");

    photoFiles.forEach((photo) => validateUploadFile(photo, ACCEPTED_PHOTO_TYPES, ACCEPTED_PHOTO_EXTENSIONS, "A imagem"));

    if (isFile(soilAnalysis)) {
      validateUploadFile(soilAnalysis, ACCEPTED_SOIL_ANALYSIS_TYPES, ACCEPTED_SOIL_ANALYSIS_EXTENSIONS, "A análise de solo");
    }

    const user = await getAuthenticatedUser(token, config);

    if (photoFiles.length > 0) {
      await assertPlanFeature(user.id, "photo_upload");
    }

    if (isFile(soilAnalysis)) {
      await assertPlanFeature(user.id, "soil_analysis_upload");
    }

    const farmName = optionalText(formData, "farmName");
    const city = optionalText(formData, "city");
    const areaHectares = optionalNumber(formData, "areaHectares");
    const soilType = optionalText(formData, "soilType");

    const farmPayload = {
      user_id: user.id,
      name: farmName,
      city,
      state,
      area_hectares: areaHectares,
      soil_type: soilType
    };

    const farms = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/farms?select=id&name=eq." + encodeURIComponent(farmName ?? "") + "&city=eq." + encodeURIComponent(city ?? "") + "&state=eq." + encodeURIComponent(state) + "&limit=1",
      { method: "GET" },
      token,
      config
    );

    const farm = farms[0]
      ? (
          await supabaseRequest<Array<{ id: string }>>(
            `/rest/v1/farms?id=eq.${farms[0].id}&select=id`,
            { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(farmPayload) },
            token,
            config
          )
        )[0]
      : (
          await supabaseRequest<Array<{ id: string }>>(
            "/rest/v1/farms?select=id",
            { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(farmPayload) },
            token,
            config
          )
        )[0];

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
            growth_stage: optionalText(formData, "growthStage"),
            symptoms,
            history: optionalText(formData, "managementHistory"),
            status: "submitted"
          })
        },
        token,
        config
      )
    )[0];

    const uploadedImages = [];

    for (const photo of photoFiles) {
      const path = `${user.id}/${createdCase.id}/${sanitizeFileName(photo.name)}`;
      const imageUrl = await uploadToStorage(photo, path, token, config);
      uploadedImages.push({ case_id: createdCase.id, user_id: user.id, image_url: imageUrl, image_type: photo.type || "image" });
    }

    if (uploadedImages.length > 0) {
      await supabaseRequest(
        "/rest/v1/case_images",
        { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(uploadedImages) },
        token,
        config
      );
    }

    if (isFile(soilAnalysis)) {
      const path = `${user.id}/${createdCase.id}/${sanitizeFileName(soilAnalysis.name)}`;
      const soilAnalysisUrl = await uploadToStorage(soilAnalysis, path, token, config);

      await supabaseRequest(
        `/rest/v1/agronomic_cases?id=eq.${createdCase.id}`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ soil_analysis_url: soilAnalysisUrl }) },
        token,
        config
      );
    }

    return NextResponse.json({ caseId: createdCase.id });
  } catch (error) {
    if (error instanceof PlanFeatureUnavailableError) {
      return NextResponse.json({ error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Não foi possível salvar o caso agronômico.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

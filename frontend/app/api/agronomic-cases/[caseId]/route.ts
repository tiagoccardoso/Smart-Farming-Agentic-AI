import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser, getSupabaseConfig, supabaseRequest } from "../../../../lib/agronomic/case";
import { PLAN_LIMIT_REACHED_MESSAGE, PlanFeatureUnavailableError, assertPlanFeature } from "../../../../lib/billing/check-plan-limits";
import { getSupabaseAdminConfig, supabaseAdminRequest } from "../../../../lib/stripe/humanReview";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

class FriendlyRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length ? value : null;
}

function optionalNumber(formData: FormData, key: string) {
  const value = text(formData, key).replace(",", ".");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeFileName(fileName: string) {
  return fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "arquivo";
}

function extension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateFile(file: File, acceptedTypes: string[], acceptedExtensions: string[], label: string) {
  if (!acceptedTypes.includes(file.type) || !acceptedExtensions.includes(extension(file.name))) {
    throw new FriendlyRequestError(`${label} \"${file.name}\" não está em um formato aceito.`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FriendlyRequestError(`${label} \"${file.name}\" excede o limite de 10MB.`);
  }
}

async function uploadToStorage(file: File, path: string, token: string) {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: Buffer.from(await file.arrayBuffer()),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Não foi possível enviar ${file.name}.`);
  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function logActivity(caseId: string, userId: string, action: string, metadata: Record<string, unknown>, token: string) {
  await supabaseRequest(
    "/rest/v1/case_activity_logs",
    { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ case_id: caseId, user_id: userId, action, metadata }) },
    token,
  ).catch(() => null);
}

function extractStoragePath(url: string | null | undefined) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex >= 0) return decodeURIComponent(url.slice(markerIndex + marker.length));
  const privateMarker = `/storage/v1/object/${STORAGE_BUCKET}/`;
  const privateIndex = url.indexOf(privateMarker);
  if (privateIndex >= 0) return decodeURIComponent(url.slice(privateIndex + privateMarker.length));
  return null;
}

async function deleteStorageObjects(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (!uniquePaths.length) return;
  const config = getSupabaseAdminConfig();
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}`, {
    method: "DELETE",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: uniquePaths }),
    cache: "no-store",
  });
  if (!response.ok && process.env.NODE_ENV !== "production") {
    const payload = await response.json().catch(() => null);
    console.error("Não foi possível remover todos os arquivos do storage.", payload);
  }
}

async function assertCaseOwner(caseId: string, token: string) {
  const user = await getAuthenticatedUser(token);
  const caseData = await fetchAgronomicCase(caseId, token);
  if (!caseData) throw new FriendlyRequestError("Caso não encontrado ou sem permissão de acesso.", 404);
  if (caseData.user_id !== user.id) throw new FriendlyRequestError("Você só pode alterar seus próprios casos.", 403);
  return { user, caseData };
}

export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para consultar o caso agronômico." }, { status: 401 });
    const { user, caseData } = await assertCaseOwner(params.caseId, token);
    const activityLogs = await supabaseRequest<Array<{ id: string; action: string; metadata: Record<string, unknown> | null; created_at: string | null }>>(
      `/rest/v1/case_activity_logs?case_id=eq.${encodeURIComponent(params.caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,action,metadata,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
    ).catch(() => []);
    return NextResponse.json({ case: caseData, activityLogs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar o caso agronômico.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para editar o caso agronômico." }, { status: 401 });
    const { user, caseData } = await assertCaseOwner(params.caseId, token);
    const formData = await request.formData();
    const crop = text(formData, "crop");
    const state = text(formData, "state");
    const symptoms = text(formData, "symptoms");
    if (!crop || !state || !symptoms) return NextResponse.json({ error: "Preencha cultura, estado e sintomas." }, { status: 400 });

    const photoFiles = formData.getAll("photos").filter(isFile);
    const soilAnalysis = formData.get("soilAnalysis");
    photoFiles.forEach((file) => validateFile(file, ACCEPTED_PHOTO_TYPES, ACCEPTED_PHOTO_EXTENSIONS, "A imagem"));
    if (isFile(soilAnalysis)) validateFile(soilAnalysis, ACCEPTED_SOIL_ANALYSIS_TYPES, ACCEPTED_SOIL_ANALYSIS_EXTENSIONS, "A análise de solo");
    if (photoFiles.length > 0) await assertPlanFeature(user.id, "photo_upload");
    if (isFile(soilAnalysis)) await assertPlanFeature(user.id, "soil_analysis_upload");

    const config = getSupabaseConfig();
    const farmPayload = { user_id: user.id, name: optionalText(formData, "farmName"), city: optionalText(formData, "city"), state, area_hectares: optionalNumber(formData, "areaHectares"), soil_type: optionalText(formData, "soilType") };
    if (caseData.farm_id) {
      await supabaseRequest(`/rest/v1/farms?id=eq.${encodeURIComponent(caseData.farm_id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(farmPayload) }, token, config);
    }

    const preservesHumanReviewFlow = caseData.human_review_requested || ["waiting_payment_human_review", "waiting_human_review", "human_reviewed", "completed", "cancelled"].includes(caseData.status ?? "");
    const nextStatus = preservesHumanReviewFlow ? caseData.status : (caseData.status === "draft" ? "draft" : "submitted");
    const casePatch: Record<string, unknown> = { crop, growth_stage: optionalText(formData, "growthStage"), symptoms, history: optionalText(formData, "managementHistory"), status: nextStatus };
    if (isFile(soilAnalysis)) {
      const soilPath = `${user.id}/${params.caseId}/${Date.now()}-${sanitizeFileName(soilAnalysis.name)}`;
      casePatch.soil_analysis_url = await uploadToStorage(soilAnalysis, soilPath, token);
    }
    await supabaseRequest(`/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(params.caseId)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(casePatch) }, token, config);

    const images = [];
    for (const file of photoFiles) {
      const imagePath = `${user.id}/${params.caseId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      images.push({ case_id: params.caseId, user_id: user.id, image_url: await uploadToStorage(file, imagePath, token), image_type: file.type || "image" });
    }
    if (images.length) await supabaseRequest("/rest/v1/case_images", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(images) }, token, config);
    await logActivity(params.caseId, user.id, "Usuário editou", { fields: Object.keys(casePatch), newAttachments: images.length }, token);
    return NextResponse.json({ ok: true, caseId: params.caseId, reanalysisQueued: photoFiles.length > 0 || Boolean(isFile(soilAnalysis)) });
  } catch (error) {
    if (error instanceof PlanFeatureUnavailableError) return NextResponse.json({ error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    const message = error instanceof Error ? error.message : "Não foi possível editar o caso.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para excluir o caso agronômico." }, { status: 401 });
    const { user, caseData } = await assertCaseOwner(params.caseId, token);
    if (caseData.status === "deleted" || caseData.deleted_at) return NextResponse.json({ error: "Este caso já foi excluído." }, { status: 400 });

    const encodedCaseId = encodeURIComponent(params.caseId);
    const [chatFiles, diseaseAnalyses, reports] = await Promise.all([
      supabaseAdminRequest<Array<{ file_url: string | null }>>(`/rest/v1/case_chat_messages?case_id=eq.${encodedCaseId}&select=file_url`, { method: "GET" }).catch(() => []),
      supabaseAdminRequest<Array<{ image_url: string | null }>>(`/rest/v1/disease_image_analyses?case_id=eq.${encodedCaseId}&select=image_url`, { method: "GET" }).catch(() => []),
      supabaseAdminRequest<Array<{ report_url: string | null }>>(`/rest/v1/reports?case_id=eq.${encodedCaseId}&select=report_url`, { method: "GET" }).catch(() => []),
    ]);

    const storagePaths = [
      caseData.soil_analysis_url,
      ...caseData.images.map((image) => image.image_url),
      ...chatFiles.map((message) => message.file_url),
      ...diseaseAnalyses.map((analysis) => analysis.image_url),
      ...reports.map((report) => report.report_url),
    ].map(extractStoragePath).filter((path): path is string => Boolean(path));

    await deleteStorageObjects(storagePaths);
    await supabaseAdminRequest(`/rest/v1/one_time_orders?case_id=eq.${encodedCaseId}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => null);
    await supabaseAdminRequest(`/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível excluir o caso.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

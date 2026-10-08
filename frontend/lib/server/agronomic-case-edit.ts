/**
 * Edição de casos agronômicos (servidor).
 *
 * Causa raiz dos salvamentos perdidos (out/2026):
 * - A policy RLS "Users can update own cases" só aceita human_review_status em
 *   (not_requested, pending_payment, pending). Casos já enviados para parecer
 *   (waiting_review/in_review/...) recebiam 403 ao serem editados.
 * - Fotos e textos iam numa única requisição multipart sem compactação: acima
 *   de 4,5 MB a Vercel recusa o corpo (413) antes de a rota rodar.
 * - O texto era gravado antes dos uploads; uma falha no meio deixava o caso
 *   salvo pela metade e arquivos órfãos.
 *
 * Solução: o servidor confirma a propriedade do caso com o token do usuário e
 * grava apenas campos de conteúdo (lista fechada) com a service role. Status de
 * revisão humana, campos da IA e de pagamento nunca são alterados aqui. Cada
 * anexo sobe em requisição própria, com caminho determinístico (idempotente) e
 * compensação (remove o arquivo se o registro no banco falhar).
 */

import {
  CASE_ATTACHMENT_LIMITS,
  CASE_STORAGE_BUCKET,
  PHOTO_EXTENSIONS,
  PHOTO_MIME_TYPES,
  SOIL_ANALYSIS_EXTENSIONS,
  SOIL_ANALYSIS_MIME_TYPES,
  buildCaseAttachmentPath,
  extractCaseStoragePath,
  isValidClientUploadId,
  publicStorageUrl,
  storagePathBelongsToCase,
  type CaseAttachmentKind,
} from "../agronomic/case-attachments";
import { getSafeUploadContentType, isAllowedUploadFile } from "../mobile-image-upload";
import {
  SupabaseRestError,
  getAuthenticatedUser,
  getSupabaseConfig,
  hasServiceRoleKey,
  supabaseRequest,
  supabaseServiceRequest,
} from "./supabase-rest";

export class CaseEditError extends Error {
  status: number;
  code: string;
  fieldErrors?: Record<string, string>;

  constructor(message: string, status = 400, code = "INVALID_REQUEST", fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "CaseEditError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export type CaseContentInput = {
  crop: string;
  state: string;
  symptoms: string;
  farmName: string | null;
  city: string | null;
  areaHectares: number | null;
  soilType: string | null;
  growthStage: string | null;
  managementHistory: string | null;
};

type OwnedCaseRow = {
  id: string;
  user_id: string;
  farm_id: string | null;
  status: string | null;
  deleted_at: string | null;
  human_review_requested: boolean | null;
  human_review_status: string | null;
  crop: string | null;
  growth_stage: string | null;
  symptoms: string | null;
  history: string | null;
  soil_analysis_url: string | null;
};

type FarmRow = {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  area_hectares: number | null;
  soil_type: string | null;
};

export type CaseImageRow = {
  id: string;
  case_id: string;
  image_url: string;
  image_type: string | null;
  created_at: string | null;
};

type PlanFeatureChecker = (userId: string, feature: "photo_upload" | "soil_analysis_upload") => Promise<unknown>;

const MAX_TEXT = { crop: 120, state: 60, city: 120, farmName: 160, soilType: 160, growthStage: 160, symptoms: 6000, managementHistory: 6000 };

function cleanString(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

/** Valida e normaliza os campos editáveis. Lança CaseEditError com fieldErrors. */
export function parseCaseContentInput(raw: Record<string, unknown>): CaseContentInput {
  const crop = cleanString(raw.crop, MAX_TEXT.crop);
  const state = cleanString(raw.state, MAX_TEXT.state);
  const symptoms = cleanString(raw.symptoms, MAX_TEXT.symptoms);
  const fieldErrors: Record<string, string> = {};

  if (!crop) fieldErrors.crop = "Informe a cultura.";
  if (!state) fieldErrors.state = "Informe o estado (UF).";
  if (!symptoms) fieldErrors.symptoms = "Descreva os sintomas observados.";

  const areaRaw = cleanString(raw.areaHectares, 30).replace(",", ".");
  let areaHectares: number | null = null;
  if (areaRaw) {
    const parsed = Number(areaRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      fieldErrors.areaHectares = "A área em hectares deve ser um número maior que zero.";
    } else {
      areaHectares = parsed;
    }
  }

  if (Object.keys(fieldErrors).length) {
    throw new CaseEditError("Revise os campos destacados antes de salvar.", 400, "VALIDATION_ERROR", fieldErrors);
  }

  const optional = (key: keyof typeof MAX_TEXT) => cleanString(raw[key], MAX_TEXT[key]) || null;

  return {
    crop,
    state,
    symptoms,
    farmName: optional("farmName"),
    city: optional("city"),
    areaHectares,
    soilType: optional("soilType"),
    growthStage: optional("growthStage"),
    managementHistory: optional("managementHistory"),
  };
}

export function normalizeRemoveImageIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : [];
  return Array.from(
    new Set(
      list
        .map((item) => String(item).trim())
        .filter((item) => /^[0-9a-fA-F-]{8,64}$/.test(item)),
    ),
  ).slice(0, 50);
}

function friendlyDbError(error: unknown): CaseEditError {
  if (error instanceof CaseEditError) return error;
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return new CaseEditError("Sua sessão expirou. Faça login novamente; suas alterações continuam na tela.", 401, "AUTH_REQUIRED");
    }
    if (error.status === 403 || error.code === "42501") {
      return new CaseEditError("O banco recusou a gravação por permissão. Avise o suporte; suas alterações continuam na tela.", 403, "DATABASE_PERMISSION_DENIED");
    }
    if (error.status === 404) {
      return new CaseEditError("Caso não encontrado.", 404, "NOT_FOUND");
    }
  }
  return new CaseEditError("Não foi possível salvar no banco agora. Tente novamente em instantes.", 502, "DATABASE_ERROR");
}

export async function loadOwnedCase(caseId: string, token: string) {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(caseId)) {
    throw new CaseEditError("Caso inválido.", 400, "INVALID_CASE_ID");
  }

  let user: { id: string };
  try {
    user = await getAuthenticatedUser(token);
  } catch {
    throw new CaseEditError("Sua sessão expirou. Faça login novamente; suas alterações continuam na tela.", 401, "AUTH_REQUIRED");
  }

  const rows = await supabaseRequest<OwnedCaseRow[]>(
    `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}&select=id,user_id,farm_id,status,deleted_at,human_review_requested,human_review_status,crop,growth_stage,symptoms,history,soil_analysis_url&limit=1`,
    { method: "GET" },
    token,
  ).catch((error) => {
    throw friendlyDbError(error);
  });
  const caseRow = rows[0];

  if (!caseRow) throw new CaseEditError("Caso não encontrado ou sem permissão de acesso.", 404, "NOT_FOUND");
  if (caseRow.user_id !== user.id) throw new CaseEditError("Você só pode alterar seus próprios casos.", 403, "FORBIDDEN");
  if (caseRow.deleted_at || caseRow.status === "deleted") throw new CaseEditError("Este caso foi excluído.", 410, "CASE_DELETED");

  return { user, caseRow };
}

async function logCaseActivity(caseId: string, userId: string, action: string, metadata: Record<string, unknown>, token: string) {
  await supabaseServiceRequest(
    "/rest/v1/case_activity_logs",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ case_id: caseId, user_id: userId, action, metadata }),
    },
    token,
  ).catch(() => null);
}

function diffFields(before: OwnedCaseRow, farm: FarmRow | null, input: CaseContentInput) {
  const changed: string[] = [];
  const compare = (field: string, previous: unknown, next: unknown) => {
    if ((previous ?? null) !== (next ?? null)) changed.push(field);
  };
  compare("crop", before.crop, input.crop);
  compare("growth_stage", before.growth_stage, input.growthStage);
  compare("symptoms", before.symptoms, input.symptoms);
  compare("history", before.history, input.managementHistory);
  compare("farm.name", farm?.name, input.farmName);
  compare("farm.city", farm?.city, input.city);
  compare("farm.state", farm?.state, input.state);
  compare("farm.area_hectares", farm?.area_hectares === null || farm?.area_hectares === undefined ? null : Number(farm.area_hectares), input.areaHectares);
  compare("farm.soil_type", farm?.soil_type, input.soilType);
  return changed;
}

export async function deleteCaseObjects(paths: string[], token: string) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return;
  await supabaseServiceRequest(
    `/storage/v1/object/${CASE_STORAGE_BUCKET}`,
    { method: "DELETE", body: JSON.stringify({ prefixes: unique }) },
    token,
  ).catch(() => null);
}

/**
 * Atualiza textos, propriedade e (opcionalmente) remove imagens escolhidas pelo
 * usuário. Não mexe em status, revisão humana nem campos da IA.
 */
export async function updateCaseContent(options: {
  caseId: string;
  token: string;
  input: CaseContentInput;
  removeImageIds?: string[];
}) {
  const { caseId, token, input } = options;
  const { user, caseRow } = await loadOwnedCase(caseId, token);
  const removeImageIds = options.removeImageIds ?? [];

  try {
    const farms = caseRow.farm_id
      ? await supabaseRequest<FarmRow[]>(
          `/rest/v1/farms?id=eq.${encodeURIComponent(caseRow.farm_id)}&select=id,name,city,state,area_hectares,soil_type&limit=1`,
          { method: "GET" },
          token,
        )
      : [];
    const farm = farms[0] ?? null;
    const changedFields = diffFields(caseRow, farm, input);
    const farmPayload = {
      name: input.farmName,
      city: input.city,
      state: input.state,
      area_hectares: input.areaHectares,
      soil_type: input.soilType,
    };
    let farmId = caseRow.farm_id;

    if (farmId) {
      const updatedFarms = await supabaseServiceRequest<FarmRow[]>(
        `/rest/v1/farms?id=eq.${encodeURIComponent(farmId)}&user_id=eq.${encodeURIComponent(user.id)}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(farmPayload) },
        token,
      );
      if (!updatedFarms?.length) {
        throw new CaseEditError("Os dados da propriedade não foram gravados. Tente novamente.", 409, "FARM_NOT_UPDATED");
      }
    } else {
      // Caso antigo sem propriedade: antes os campos eram descartados em silêncio.
      const createdFarms = await supabaseServiceRequest<FarmRow[]>(
        "/rest/v1/farms",
        { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...farmPayload, user_id: user.id }) },
        token,
      );
      farmId = createdFarms?.[0]?.id ?? null;
    }

    const casePatch: Record<string, unknown> = {
      crop: input.crop,
      growth_stage: input.growthStage,
      symptoms: input.symptoms,
      history: input.managementHistory,
    };
    if (farmId && farmId !== caseRow.farm_id) casePatch.farm_id = farmId;

    // return=representation: confirma que a linha foi de fato alterada. Um
    // UPDATE bloqueado silenciosamente devolve lista vazia.
    const updatedCases = await supabaseServiceRequest<Array<{ id: string; updated_at: string | null }>>(
      `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,updated_at`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(casePatch) },
      token,
    );
    if (!updatedCases?.length) {
      throw new CaseEditError("O caso não foi atualizado no banco. Tente novamente.", 409, "CASE_NOT_UPDATED");
    }

    let removedImages = 0;
    if (removeImageIds.length) {
      const images = await supabaseRequest<CaseImageRow[]>(
        `/rest/v1/case_images?case_id=eq.${encodeURIComponent(caseId)}&id=in.(${removeImageIds.map(encodeURIComponent).join(",")})&select=id,case_id,image_url,image_type,created_at`,
        { method: "GET" },
        token,
      );
      if (images.length) {
        const deleted = await supabaseServiceRequest<CaseImageRow[]>(
          `/rest/v1/case_images?case_id=eq.${encodeURIComponent(caseId)}&id=in.(${images.map((image) => encodeURIComponent(image.id)).join(",")})`,
          { method: "DELETE", headers: { Prefer: "return=representation" } },
          token,
        );
        removedImages = deleted?.length ?? 0;
        // Com parecer humano solicitado, o arquivo fica no storage para não
        // apagar material que a especialista pode ter consultado.
        if (!caseRow.human_review_requested) {
          await deleteCaseObjects(
            images
              .map((image) => extractCaseStoragePath(image.image_url))
              .filter((path): path is string => storagePathBelongsToCase(path, user.id, caseId)),
            token,
          );
        }
      }
    }

    if (changedFields.length || removedImages) {
      await logCaseActivity(
        caseId,
        user.id,
        "Usuário editou",
        { kind: "case_updated", fields: changedFields, removedImages },
        token,
      );
    }

    return { userId: user.id, changedFields, removedImages, updatedAt: updatedCases[0]?.updated_at ?? null };
  } catch (error) {
    throw friendlyDbError(error);
  }
}

export async function uploadCaseObject(file: File, path: string, token: string) {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${CASE_STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": await getSafeUploadContentType(file),
      "x-upsert": "false",
    },
    body: Buffer.from(await file.arrayBuffer()),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: { statusCode?: string | number; error?: string; message?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (response.ok) return { url: publicStorageUrl(config.supabaseUrl, path), alreadyExisted: false };

  const duplicate =
    response.status === 409 ||
    String(payload?.statusCode) === "409" ||
    /duplicate|already exists/i.test(`${payload?.error ?? ""} ${payload?.message ?? ""}`);
  if (duplicate) return { url: publicStorageUrl(config.supabaseUrl, path), alreadyExisted: true };

  const detail = `${payload?.error ?? ""} ${payload?.message ?? ""}`;
  if (response.status === 401) {
    throw new CaseEditError("Sua sessão expirou durante o envio. Faça login novamente e tente de novo.", 401, "AUTH_REQUIRED");
  }
  if (response.status === 413 || /too large|size/i.test(detail)) {
    throw new CaseEditError(`"${file.name}" está acima do tamanho permitido pelo armazenamento.`, 400, "FILE_TOO_LARGE");
  }
  if (/mime|content.?type|not allowed|invalid_mime/i.test(detail)) {
    const hint = file.type.startsWith("audio/") ? "Envie áudio em WEBM, OGG, M4A, MP3 ou WAV." : file.type === "application/pdf" ? "Envie PDF, JPG ou PNG." : "Envie JPG, PNG ou WEBP.";
    throw new CaseEditError(`O armazenamento recusou o formato de "${file.name}". ${hint}`, 400, "UNSUPPORTED_TYPE");
  }
  if (response.status === 403) {
    throw new CaseEditError("O armazenamento recusou o arquivo por permissão. Avise o suporte.", 403, "STORAGE_PERMISSION_DENIED");
  }
  throw new CaseEditError(`Não foi possível enviar "${file.name}". Tente novamente.`, response.status >= 500 ? 502 : 400, "UPLOAD_FAILED");
}

/**
 * Envia UM anexo para um caso existente. Idempotente pelo `clientUploadId`:
 * repetir a mesma chamada não duplica o arquivo nem o registro.
 */
export async function addCaseAttachment(options: {
  caseId: string;
  token: string;
  file: File;
  kind: CaseAttachmentKind;
  clientUploadId?: string | null;
  checkPlanFeature?: PlanFeatureChecker;
}) {
  const { caseId, token, file, kind } = options;
  const { user, caseRow } = await loadOwnedCase(caseId, token);
  const isPhoto = kind === "photo";
  const label = isPhoto ? "A imagem" : "A análise de solo";

  if (!file || file.size === 0) throw new CaseEditError("Arquivo vazio ou ausente.", 400, "FILE_MISSING");

  const allowed = await isAllowedUploadFile(
    file,
    isPhoto ? PHOTO_MIME_TYPES : SOIL_ANALYSIS_MIME_TYPES,
    isPhoto ? PHOTO_EXTENSIONS : SOIL_ANALYSIS_EXTENSIONS,
  );
  if (!allowed) {
    throw new CaseEditError(
      `${label} "${file.name}" não está em um formato aceito (${isPhoto ? "JPG, PNG, WEBP ou HEIC" : "PDF, JPG ou PNG"}).`,
      400,
      "UNSUPPORTED_TYPE",
    );
  }
  const maxBytes = isPhoto ? CASE_ATTACHMENT_LIMITS.maxPhotoBytes : CASE_ATTACHMENT_LIMITS.maxSoilAnalysisBytes;
  if (file.size > maxBytes) {
    throw new CaseEditError(`${label} "${file.name}" excede o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.`, 400, "FILE_TOO_LARGE");
  }

  if (options.checkPlanFeature) {
    await options.checkPlanFeature(user.id, isPhoto ? "photo_upload" : "soil_analysis_upload");
  }

  const clientUploadId = isValidClientUploadId(options.clientUploadId) ? options.clientUploadId : crypto.randomUUID();
  const path = buildCaseAttachmentPath({ userId: user.id, caseId, kind, clientUploadId, fileName: file.name });
  const { url, alreadyExisted } = await uploadCaseObject(file, path, token);

  try {
    if (isPhoto) {
      const existing = await supabaseServiceRequest<CaseImageRow[]>(
        `/rest/v1/case_images?case_id=eq.${encodeURIComponent(caseId)}&image_url=eq.${encodeURIComponent(url)}&select=id,case_id,image_url,image_type,created_at&limit=1`,
        { method: "GET" },
        token,
      );
      if (existing?.[0]) return { image: existing[0], soilAnalysisUrl: null, alreadyExisted: true, userId: user.id };

      const inserted = await supabaseServiceRequest<CaseImageRow[]>(
        "/rest/v1/case_images?select=id,case_id,image_url,image_type,created_at",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ case_id: caseId, user_id: user.id, image_url: url, image_type: (await getSafeUploadContentType(file, "image")) || "image" }),
        },
        token,
      );
      const image = inserted?.[0];
      if (!image) throw new CaseEditError("A imagem foi enviada, mas não foi vinculada ao caso.", 502, "IMAGE_NOT_LINKED");
      await logCaseActivity(caseId, user.id, "Nova imagem anexada", { kind: "attachment_added", attachment: "photo", imageId: image.id }, token);
      return { image, soilAnalysisUrl: null, alreadyExisted, userId: user.id };
    }

    if (caseRow.soil_analysis_url !== url) {
      const updated = await supabaseServiceRequest<Array<{ id: string }>>(
        `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ soil_analysis_url: url }) },
        token,
      );
      if (!updated?.length) throw new CaseEditError("A análise de solo foi enviada, mas não foi vinculada ao caso.", 502, "SOIL_NOT_LINKED");
      await logCaseActivity(
        caseId,
        user.id,
        "Análise de solo anexada",
        { kind: "attachment_added", attachment: "soil_analysis", previousSoilAnalysisUrl: caseRow.soil_analysis_url },
        token,
      );
    }
    return { image: null, soilAnalysisUrl: url, alreadyExisted, userId: user.id };
  } catch (error) {
    // Compensação: arquivo novo sem registro no banco não pode ficar órfão.
    if (!alreadyExisted) await deleteCaseObjects([path], token);
    throw friendlyDbError(error);
  }
}

export { hasServiceRoleKey };

import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE } from "../../../../lib/auth";
import {
  fetchAgronomicCase,
  getAuthenticatedUser,
  supabaseRequest,
} from "../../../../lib/agronomic/case";
import {
  PlanFeatureUnavailableError,
  assertPlanFeature,
} from "../../../../lib/billing/check-plan-limits";
import {
  getSupabaseAdminConfig,
  supabaseAdminRequest,
} from "../../../../lib/stripe/humanReview";
import {
  type StoredHumanReview,
  buildClientHumanReview,
  pickClientReviewRow,
} from "../../../../lib/agronomic/client-review";
import { computeCaseFreshness, splitActivityLogs } from "../../../../lib/agronomic/case-freshness";
import {
  CaseEditError,
  addCaseAttachment,
  normalizeRemoveImageIds,
  parseCaseContentInput,
  updateCaseContent,
} from "../../../../lib/server/agronomic-case-edit";

const STORAGE_BUCKET = "agronomic-cases";

function getRequestToken(request: NextRequest) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.cookies.get(AUTH_ACCESS_COOKIE)?.value ||
    ""
  );
}

class FriendlyRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function extractStoragePath(url: string | null | undefined) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex >= 0)
    return decodeURIComponent(url.slice(markerIndex + marker.length));
  const privateMarker = `/storage/v1/object/${STORAGE_BUCKET}/`;
  const privateIndex = url.indexOf(privateMarker);
  if (privateIndex >= 0)
    return decodeURIComponent(url.slice(privateIndex + privateMarker.length));
  return null;
}

async function deleteStorageObjects(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (!uniquePaths.length) return;
  const config = getSupabaseAdminConfig();
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}`,
    {
      method: "DELETE",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: uniquePaths }),
      cache: "no-store",
    },
  );
  if (!response.ok && process.env.NODE_ENV !== "production") {
    const payload = await response.json().catch(() => null);
    console.error(
      "Não foi possível remover todos os arquivos do storage.",
      payload,
    );
  }
}

async function assertCaseOwner(caseId: string, token: string) {
  const user = await getAuthenticatedUser(token);
  const caseData = await fetchAgronomicCase(caseId, token);
  if (!caseData)
    throw new FriendlyRequestError(
      "Caso não encontrado ou sem permissão de acesso.",
      404,
    );
  if (caseData.user_id !== user.id)
    throw new FriendlyRequestError(
      "Você só pode alterar seus próprios casos.",
      403,
    );
  return { user, caseData };
}

type ClientReport = {
  id: string;
  report_url: string | null;
  report_type: string | null;
  created_at: string | null;
};

/**
 * Parecer do agrônomo exibido ao dono do caso (tela Revisão Humana).
 * - Leitura de human_reviews com o token do próprio usuário (RLS do dono).
 * - Texto só é devolvido quando o parecer está finalizado (rascunho nunca).
 * - Nome do responsável: apenas `full_name`, lido pelo servidor porque o
 *   produtor não tem acesso ao perfil da especialista; falha → sem nome.
 */
async function loadClientHumanReview(
  caseData: { id: string; human_review_status: string | null; human_review_requested: boolean },
  activityLogs: Array<{ action: string; created_at: string | null }>,
  token: string,
) {
  const rows = await supabaseRequest<StoredHumanReview[]>(
    `/rest/v1/human_reviews?case_id=eq.${encodeURIComponent(caseData.id)}&select=id,case_id,specialist_id,status,review_text,technical_recommendation,final_observations,reviewed_at,created_at&order=created_at.desc`,
    { method: "GET" },
    token,
  ).catch(() => [] as StoredHumanReview[]);

  const current = pickClientReviewRow(rows, caseData.human_review_status);
  const specialistId =
    current?.status === "completed" ? current.specialist_id : null;
  const specialistName = specialistId
    ? await supabaseAdminRequest<Array<{ full_name: string | null }>>(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(specialistId)}&select=full_name&limit=1`,
        { method: "GET" },
      )
        .then((profiles) => profiles[0]?.full_name ?? null)
        .catch(() => null)
    : null;

  return buildClientHumanReview({
    rows,
    humanReviewStatus: caseData.human_review_status,
    activityLogs,
    specialistName,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const token = getRequestToken(request);
    if (!token)
      return NextResponse.json(
        { error: "Faça login para consultar o caso agronômico." },
        { status: 401 },
      );
    const { user, caseData } = await assertCaseOwner(params.caseId, token);
    const rawActivityLogs = await supabaseRequest<
      Array<{
        id: string;
        action: string;
        metadata: Record<string, unknown> | null;
        created_at: string | null;
      }>
    >(
      `/rest/v1/case_activity_logs?case_id=eq.${encodeURIComponent(params.caseId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,action,metadata,created_at&order=created_at.asc`,
      { method: "GET" },
      token,
    ).catch(() => []);
    const { activityLogs, analysisHistory } = splitActivityLogs(rawActivityLogs);
    const freshness = computeCaseFreshness({
      hasAnalysis: Boolean(caseData.ai_analysis_json || caseData.ai_summary),
      analyzedAt: caseData.ai_analysis_json?.analyzedAt ?? null,
      activityLogs: rawActivityLogs,
    });
    const humanReview = await loadClientHumanReview(caseData, activityLogs, token);
    const latestReport = await supabaseRequest<ClientReport[]>(
      `/rest/v1/reports?case_id=eq.${encodeURIComponent(params.caseId)}&select=id,report_url,report_type,created_at&order=created_at.desc&limit=1`,
      { method: "GET" },
      token,
    )
      .then((rows) => rows[0] ?? null)
      .catch(() => null);
    return NextResponse.json(
      { case: caseData, activityLogs, analysisHistory, freshness, humanReview, latestReport },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar o caso agronômico.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function editErrorResponse(error: unknown, extra: Record<string, unknown> = {}) {
  if (error instanceof PlanFeatureUnavailableError) {
    return NextResponse.json(
      {
        error: `${error.message} Remova o anexo para salvar sem ele ou atualize o plano.`,
        code: "PLAN_FEATURE_UNAVAILABLE",
        cta: error.cta,
        ...extra,
      },
      { status: error.status },
    );
  }
  if (error instanceof CaseEditError) {
    return NextResponse.json(
      { error: error.message, code: error.code, fieldErrors: error.fieldErrors, ...extra },
      { status: error.status },
    );
  }
  console.error("[agronomic-case-edit] falha inesperada", {
    message: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: "Não foi possível salvar o caso agora. Suas alterações continuam na tela; tente novamente.", code: "UNEXPECTED", ...extra },
    { status: 500 },
  );
}

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function isNonEmptyFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

/**
 * Atualiza textos/propriedade e remove imagens escolhidas.
 * - JSON (tela de casos): `{ crop, state, symptoms, ..., removeImageIds }`.
 *   Fotos e análise de solo sobem depois, uma por requisição, em
 *   POST /api/agronomic-cases/[caseId]/attachments.
 * - multipart (compatibilidade com /enviar-caso?caseId=): os mesmos campos e,
 *   opcionalmente, `photos` e `soilAnalysis` já compactados no navegador.
 * Responde com o caso relido do banco para a tela confirmar o que persistiu.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const token = getRequestToken(request);
  if (!token)
    return NextResponse.json(
      { error: "Faça login para editar o caso agronômico.", code: "AUTH_REQUIRED" },
      { status: 401 },
    );

  const contentType = request.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};
  let photos: File[] = [];
  let soilAnalysis: File | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      raw = Object.fromEntries(
        ["crop", "farmName", "city", "state", "areaHectares", "soilType", "growthStage", "symptoms", "managementHistory"].map((key) => [key, formValue(formData, key)]),
      );
      raw.removeImageIds = formData.getAll("removeImageIds").map(String);
      photos = formData.getAll("photos").filter(isNonEmptyFile);
      const soil = formData.get("soilAnalysis");
      soilAnalysis = isNonEmptyFile(soil) ? soil : null;
    } else {
      raw = ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
    }
  } catch {
    return NextResponse.json(
      { error: "Não foi possível ler os dados enviados. Se havia fotos grandes, tente enviá-las novamente.", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  let contentSaved = false;
  try {
    const input = parseCaseContentInput(raw);
    const result = await updateCaseContent({
      caseId: params.caseId,
      token,
      input,
      removeImageIds: normalizeRemoveImageIds(raw.removeImageIds),
    });
    contentSaved = true;

    const failedAttachments: Array<{ name: string; error: string }> = [];
    let newAttachments = 0;
    for (const [index, file] of photos.entries()) {
      try {
        await addCaseAttachment({ caseId: params.caseId, token, file, kind: "photo", clientUploadId: `legacy-${Date.now()}-${index}`, checkPlanFeature: assertPlanFeature });
        newAttachments += 1;
      } catch (error) {
        failedAttachments.push({ name: file.name, error: error instanceof Error ? error.message : "Falha no envio." });
      }
    }
    if (soilAnalysis) {
      try {
        await addCaseAttachment({ caseId: params.caseId, token, file: soilAnalysis, kind: "soil_analysis", checkPlanFeature: assertPlanFeature });
        newAttachments += 1;
      } catch (error) {
        failedAttachments.push({ name: soilAnalysis.name, error: error instanceof Error ? error.message : "Falha no envio." });
      }
    }

    const caseData = await fetchAgronomicCase(params.caseId, token).catch(() => null);

    if (failedAttachments.length) {
      return NextResponse.json(
        {
          error: `Os textos foram salvos, mas ${failedAttachments.length} anexo(s) não foram enviados: ${failedAttachments.map((item) => `${item.name} (${item.error})`).join("; ")}`,
          code: "PARTIAL_SAVE",
          contentSaved: true,
          failedAttachments,
          case: caseData,
        },
        { status: 207 },
      );
    }

    return NextResponse.json({
      ok: true,
      caseId: params.caseId,
      changedFields: result.changedFields,
      removedImages: result.removedImages,
      newAttachments,
      updatedAt: result.updatedAt,
      case: caseData,
    });
  } catch (error) {
    return editErrorResponse(error, { contentSaved });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  try {
    const token = getRequestToken(request);
    if (!token)
      return NextResponse.json(
        { error: "Faça login para excluir o caso agronômico." },
        { status: 401 },
      );
    const { user, caseData } = await assertCaseOwner(params.caseId, token);
    if (caseData.status === "deleted" || caseData.deleted_at)
      return NextResponse.json(
        { error: "Este caso já foi excluído." },
        { status: 400 },
      );

    const encodedCaseId = encodeURIComponent(params.caseId);
    const [chatFiles, diseaseAnalyses, reports] = await Promise.all([
      supabaseAdminRequest<Array<{ file_url: string | null }>>(
        `/rest/v1/case_chat_messages?case_id=eq.${encodedCaseId}&select=file_url`,
        { method: "GET" },
      ).catch(() => []),
      supabaseAdminRequest<Array<{ image_url: string | null }>>(
        `/rest/v1/disease_image_analyses?case_id=eq.${encodedCaseId}&select=image_url`,
        { method: "GET" },
      ).catch(() => []),
      supabaseAdminRequest<Array<{ report_url: string | null }>>(
        `/rest/v1/reports?case_id=eq.${encodedCaseId}&select=report_url`,
        { method: "GET" },
      ).catch(() => []),
    ]);

    const storagePaths = [
      caseData.soil_analysis_url,
      ...caseData.images.map((image) => image.image_url),
      ...chatFiles.map((message) => message.file_url),
      ...diseaseAnalyses.map((analysis) => analysis.image_url),
      ...reports.map((report) => report.report_url),
    ]
      .map(extractStoragePath)
      .filter((path): path is string => Boolean(path));

    await deleteStorageObjects(storagePaths);
    await supabaseAdminRequest(
      `/rest/v1/one_time_orders?case_id=eq.${encodedCaseId}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    ).catch(() => null);
    await supabaseAdminRequest(
      `/rest/v1/agronomic_cases?id=eq.${encodedCaseId}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível excluir o caso.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

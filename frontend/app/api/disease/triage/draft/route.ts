import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DISEASE_TRIAGE_COOKIE,
  DISEASE_TRIAGE_LIMITS,
  validateDiseaseTriageForm,
  type DiseaseTriageField,
  type DiseaseTriageForm,
} from "../../../../../lib/disease/triage";
import { detectMimeFromBytes, formatBytes } from "../../../../../lib/public-requests/config";
import {
  cleanupExpiredDiseaseDrafts,
  consumeDiseaseDraftRateLimit,
  createDraft,
  deleteDraftRow,
  deleteDraftStorageObjects,
  draftCookieOptions,
  findDraftBySubmissionKey,
  hashDraftToken,
  isValidSubmissionKey,
  newDraftToken,
  type DiseaseTriageDraftAttachment,
  updateDraft,
  uploadDraftAttachment,
} from "../../../../../lib/server/disease-triage-draft";

const IMAGE_KEYS = ["photos", "files"];

function text(formData: FormData, key: DiseaseTriageField) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function isFile(value: FormDataEntryValue): value is File {
  return value instanceof File && value.size > 0;
}

function friendlyError(error: unknown) {
  if (error instanceof Error && !/SUPABASE|SERVICE_ROLE|NEXT_PUBLIC|apikey|secret|token/i.test(error.message)) {
    return error.message;
  }
  return "Não foi possível preservar a triagem agora. Tente novamente em instantes.";
}

function validationError(field: string, error: string, status = 400) {
  return NextResponse.json({ error, field }, { status });
}

async function validateImages(files: File[]) {
  if (files.length < 1) throw new Error("Adicione pelo menos uma fotografia da planta ou da parte afetada.");
  if (files.length > DISEASE_TRIAGE_LIMITS.maxImages) {
    throw new Error(`Envie no máximo ${DISEASE_TRIAGE_LIMITS.maxImages} fotografias.`);
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > DISEASE_TRIAGE_LIMITS.maxTotalImageBytes) {
    throw new Error(`As fotografias somam mais de ${formatBytes(DISEASE_TRIAGE_LIMITS.maxTotalImageBytes)}.`);
  }

  const prepared: Array<{ file: File; bytes: Uint8Array }> = [];
  for (const file of files) {
    if (file.size > DISEASE_TRIAGE_LIMITS.maxImageBytes) {
      throw new Error(`A imagem "${file.name}" excede o limite de ${formatBytes(DISEASE_TRIAGE_LIMITS.maxImageBytes)}.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectMimeFromBytes(bytes.subarray(0, 64));
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      throw new Error(`A imagem "${file.name}" não está em um formato aceito. Envie JPG, PNG ou WEBP.`);
    }
    prepared.push({ file, bytes });
  }
  return prepared;
}

export async function POST(request: NextRequest) {
  let uploadedPaths: string[] = [];
  let createdDraftId: string | null = null;

  try {
    await cleanupExpiredDiseaseDrafts();
    if (!(await consumeDiseaseDraftRateLimit(request))) {
      return NextResponse.json({ error: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." }, { status: 429 });
    }

    const formData = await request.formData();
    const rawSubmissionKey = formData.get("submissionKey");
    const submissionKey = typeof rawSubmissionKey === "string" ? rawSubmissionKey.trim() : "";
    if (!isValidSubmissionKey(submissionKey)) {
      return validationError("photos", "Não foi possível identificar esta tentativa. Atualize a página e tente novamente.");
    }

    const existing = await findDraftBySubmissionKey(submissionKey);
    const existingIsCompleted = existing?.status === "completed" && Boolean(existing.case_id);
    const existingIsUnexpired = existing ? new Date(existing.expires_at).getTime() > Date.now() : false;
    if (existing && existing.status !== "expired" && (existingIsUnexpired || existingIsCompleted)) {
      const currentToken = request.cookies.get(DISEASE_TRIAGE_COOKIE)?.value;
      const response = NextResponse.json({
        draftId: existing.id,
        message: "Suas informações estão preservadas. Entre ou crie sua conta para continuar a triagem.",
      }, { status: 201 });

      if (!currentToken || hashDraftToken(currentToken) !== existing.token_hash) {
        const rotatedToken = newDraftToken();
        await updateDraft(existing.id, { token_hash: hashDraftToken(rotatedToken), status: existing.status === "processing" ? "pending" : existing.status });
        response.cookies.set(DISEASE_TRIAGE_COOKIE, rotatedToken, draftCookieOptions());
      }
      return response;
    }

    const rawForm = Object.fromEntries(
      Object.keys({ crop: "", affectedPart: "", symptoms: "", symptomStartDate: "", symptomEvolution: "", affectedProportion: "", environmentalConditions: "", treatmentsUsed: "", plantLocation: "", additionalInfo: "", city: "", state: "", growthStage: "", soilType: "", history: "" }).map((key) => [key, text(formData, key as DiseaseTriageField)]),
    );
    const files = IMAGE_KEYS.flatMap((key) => formData.getAll(key)).filter(isFile);
    const validation = validateDiseaseTriageForm(rawForm, files.length);
    if (!validation.ok) return validationError(validation.field, validation.message);

    const prepared = await validateImages(files);
    const draftId = crypto.randomUUID();
    const rawToken = newDraftToken();
    createdDraftId = draftId;
    const attachments: DiseaseTriageDraftAttachment[] = [];

    for (const [index, item] of prepared.entries()) {
      const stored = await uploadDraftAttachment(draftId, index, item.file, item.bytes);
      attachments.push(stored);
      uploadedPaths.push(stored.path);
    }

    const draft = await createDraft({
      draftId,
      tokenHash: hashDraftToken(rawToken),
      submissionKey,
      form: validation.value,
      attachments,
    });
    if (!draft) throw new Error("O rascunho não foi confirmado no banco.");

    const response = NextResponse.json({
      draftId: draft.id,
      message: "Suas informações estão prontas! Entre ou crie sua conta para continuar a triagem. As fotos e os dados informados serão preservados.",
    }, { status: 201 });
    response.cookies.set(DISEASE_TRIAGE_COOKIE, rawToken, draftCookieOptions());
    return response;
  } catch (error) {
    if (createdDraftId) await deleteDraftRow(createdDraftId).catch(() => undefined);
    await deleteDraftStorageObjects(uploadedPaths);
    const message = friendlyError(error);
    const status = /limite|excede|somam|fotografia|imagem|formato/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

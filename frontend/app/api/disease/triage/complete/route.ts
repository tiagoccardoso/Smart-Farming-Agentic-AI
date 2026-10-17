import { NextRequest, NextResponse } from "next/server";
import { getRequestToken, requireUser } from "../../../../../lib/server/request-auth";
import { supabaseAdminRequest, getSupabaseAdminConfig } from "../../../../../lib/server/supabaseAdmin";
import {
  CASE_STORAGE_BUCKET,
  buildCaseAttachmentPath,
  publicStorageUrl,
} from "../../../../../lib/agronomic/case-attachments";
import { buildDiseaseTriageHistory } from "../../../../../lib/disease/triage";
import {
  DISEASE_TRIAGE_COOKIE,
  claimDraft,
  deleteDraftStorageObjects,
  downloadDraftAttachment,
  findDraftByTokenHash,
  hashDraftToken,
  type DiseaseTriageDraftAttachment,
  type DiseaseTriageDraftRow,
  updateDraft,
} from "../../../../../lib/server/disease-triage-draft";

type CaseImage = { id: string; image_url: string };

function encoded(value: string) {
  return encodeURIComponent(value);
}
function adminStorageHeaders(extra: Record<string, string> = {}) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente.");
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

function caseStorageUrl(path = "") {
  const config = getSupabaseAdminConfig();
  return `${config.supabaseUrl}/storage/v1/object/${CASE_STORAGE_BUCKET}${path ? `/${path}` : ""}`;
}

function attachmentUploadId(draftId: string, index: number) {
  return `triage${draftId.replace(/-/g, "").slice(0, 28)}${index + 1}`;
}

async function uploadCaseAttachment(input: {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}) {
  const response = await fetch(caseStorageUrl(input.path), {
    method: "POST",
    headers: adminStorageHeaders({
      "Content-Type": input.mimeType,
      "x-upsert": "false",
      "cache-control": "private, max-age=0",
    }),
    body: Buffer.from(input.bytes),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Falha ao transferir uma imagem para o caso (${response.status}).`);
  }
}

async function listCaseImages(caseId: string) {
  return supabaseAdminRequest<CaseImage[]>(
    `/rest/v1/case_images?case_id=eq.${encoded(caseId)}&select=id,image_url&order=created_at.asc`,
    { method: "GET" },
  );
}

async function transferAttachments(draft: DiseaseTriageDraftRow, userId: string, caseId: string) {
  const existing = await listCaseImages(caseId);
  const stored: CaseImage[] = [...existing];
  const { supabaseUrl } = getSupabaseAdminConfig();

  for (const [index, attachment] of draft.attachments.entries()) {
    const uploadId = attachmentUploadId(draft.id, index);
    const path = buildCaseAttachmentPath({
      userId,
      caseId,
      kind: "photo",
      clientUploadId: uploadId,
      fileName: attachment.original_name,
    });
    const publicUrl = publicStorageUrl(supabaseUrl, path, CASE_STORAGE_BUCKET);
    const alreadyStored = stored.find((image) => image.image_url === publicUrl || image.image_url.includes(`/${uploadId}-`));
    if (alreadyStored) continue;

    const bytes = await downloadDraftAttachment(attachment.path);
    await uploadCaseAttachment({ path, bytes, mimeType: attachment.mime_type });
    const inserted = await supabaseAdminRequest<CaseImage[]>(
      "/rest/v1/case_images?select=id,image_url",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          case_id: caseId,
          user_id: userId,
          image_url: publicUrl,
          image_type: "public_disease_triage",
        }),
      },
    );
    if (inserted[0]) stored.push(inserted[0]);
  }

  if (stored.length < draft.attachments.length) {
    throw new Error("O caso foi criado, mas nem todas as imagens foram confirmadas.");
  }
}

async function findOrCreateFarm(userId: string, form: DiseaseTriageDraftRow["form_data"]) {
  const hasLocation = Boolean(form.city || form.state || form.soilType || form.plantLocation);
  if (!hasLocation) return null;

  const name = `Triagem pública — ${form.crop}`.slice(0, 160);
  const existing = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/farms?user_id=eq.${encoded(userId)}&name=eq.${encoded(name)}&city=${form.city ? `eq.${encoded(form.city)}` : "is.null"}&state=${form.state ? `eq.${encoded(form.state)}` : "is.null"}&select=id&limit=1`,
    { method: "GET" },
  );
  if (existing[0]) return existing[0].id;

  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    "/rest/v1/farms?select=id",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId,
        name,
        city: form.city || null,
        state: form.state || null,
        soil_type: form.soilType || null,
      }),
    },
  );
  return rows[0]?.id ?? null;
}

async function findOwnedCaseForDraft(draftId: string, userId: string) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/agronomic_cases?public_triage_draft_id=eq.${encoded(draftId)}&user_id=eq.${encoded(userId)}&select=id&limit=1`,
    { method: "GET" },
  );
  return rows[0]?.id ?? null;
}

async function markCompleted(draft: DiseaseTriageDraftRow, caseId: string) {
  await updateDraft(draft.id, {
    status: "completed",
    case_id: caseId,
    completed_at: new Date().toISOString(),
  });
  await deleteDraftStorageObjects(draft.attachments.map((attachment) => attachment.path));
}

function publicResponse(caseId: string, replayed = false) {
  return NextResponse.json({
    success: true,
    caseId,
    replayed,
    message: "Seu caso foi criado com sucesso! Agora você pode solicitar uma análise por IA ou um parecer profissional.",
    redirectTo: `/consultoria-ia?caseId=${encodeURIComponent(caseId)}`,
  });
}

export async function POST(request: NextRequest) {
  const rawDraftToken = request.cookies.get(DISEASE_TRIAGE_COOKIE)?.value;
  const token = getRequestToken(request);
  if (!rawDraftToken) {
    return NextResponse.json({ error: "Não encontramos uma triagem preservada nesta sessão." }, { status: 404 });
  }
  if (!token) {
    return NextResponse.json({ error: "Faça login ou crie uma conta para continuar a triagem." }, { status: 401 });
  }

  try {
    const { user } = await requireUser(request);
    const draft = await findDraftByTokenHash(hashDraftToken(rawDraftToken));
    if (!draft) return NextResponse.json({ error: "A triagem preservada não foi encontrada ou expirou." }, { status: 404 });
    if (draft.status === "completed" && draft.case_id) return publicResponse(draft.case_id, true);
    if (new Date(draft.expires_at).getTime() <= Date.now()) {
      await updateDraft(draft.id, { status: "expired" }).catch(() => undefined);
      return NextResponse.json({ error: "A triagem expirou. Preencha os dados novamente para continuar." }, { status: 410 });
    }
    if (draft.user_id && draft.user_id !== user.id) {
      return NextResponse.json({ error: "Esta triagem pertence a outra sessão e não pode ser vinculada a esta conta." }, { status: 403 });
    }
    // Recupera um caso criado antes de uma queda entre o upload e a marcação
    // do rascunho. O índice único em public_triage_draft_id evita duplicação.
    if (draft.status === "processing") {
      const processingStartedAt = new Date(draft.updated_at).getTime();
      const processingIsStale = !Number.isFinite(processingStartedAt) || Date.now() - processingStartedAt > 10 * 60 * 1000;
      if (!processingIsStale) {
        return NextResponse.json({ error: "Estamos concluindo sua triagem. Aguarde alguns segundos e tente novamente." }, { status: 409 });
      }
      await updateDraft(draft.id, { status: "pending", user_id: draft.user_id ?? null });
    }

    const existingCaseId = await findOwnedCaseForDraft(draft.id, user.id).catch(() => null);
    if (existingCaseId) {
      await transferAttachments(draft, user.id, existingCaseId);
      await markCompleted(draft, existingCaseId);
      return publicResponse(existingCaseId, true);
    }

    const claimed = await claimDraft(draft.id, user.id);
    if (!claimed) {
      return NextResponse.json({ error: "Estamos concluindo sua triagem. Aguarde alguns segundos e tente novamente." }, { status: 409 });
    }

    try {
      const farmId = await findOrCreateFarm(user.id, draft.form_data);
      const history = buildDiseaseTriageHistory(draft.form_data);
      const rows = await supabaseAdminRequest<Array<{ id: string }>>(
        "/rest/v1/agronomic_cases?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: user.id,
            farm_id: farmId,
            crop: draft.form_data.crop,
            growth_stage: draft.form_data.growthStage || null,
            symptoms: draft.form_data.symptoms,
            history,
            status: "submitted",
            source: "public_disease_triage",
            public_triage_draft_id: draft.id,
          }),
        },
      );
      const caseId = rows[0]?.id;
      if (!caseId) throw new Error("O caso não foi confirmado no banco.");

      await transferAttachments(draft, user.id, caseId);
      await supabaseAdminRequest(
        "/rest/v1/case_activity_logs",
        {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            case_id: caseId,
            user_id: user.id,
            action: "Caso criado a partir da triagem pública",
            metadata: { kind: "public_disease_triage", draftId: draft.id },
          }),
        },
      ).catch(() => undefined);
      await markCompleted(draft, caseId);
      return publicResponse(caseId);
    } catch (error) {
      await updateDraft(draft.id, { status: "pending", user_id: user.id }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("[disease-triage] falha ao promover rascunho", error instanceof Error ? { name: error.name, message: error.message } : error);
    return NextResponse.json({ error: "Não foi possível concluir a criação do caso. Suas informações continuam salvas. Tente novamente." }, { status: 502 });
  }
}

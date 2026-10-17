import crypto from "node:crypto";
import {
  DISEASE_TRIAGE_COOKIE,
  DISEASE_TRIAGE_DRAFT_TTL_SECONDS,
  type DiseaseTriageForm,
} from "../disease/triage";
import { supabaseAdminRequest, getSupabaseAdminConfig } from "./supabaseAdmin";
import { detectMimeFromBytes, sanitizeDisplayFileName } from "../public-requests/config";

export const DISEASE_TRIAGE_DRAFT_BUCKET = "public-disease-triage-drafts";

export type DiseaseTriageDraftAttachment = {
  path: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
  original_name: string;
};

export type DiseaseTriageDraftRow = {
  id: string;
  token_hash: string;
  submission_key: string;
  user_id: string | null;
  form_data: DiseaseTriageForm;
  attachments: DiseaseTriageDraftAttachment[];
  status: "pending" | "processing" | "completed" | "expired";
  case_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export function newDraftToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashDraftToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function draftCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DISEASE_TRIAGE_DRAFT_TTL_SECONDS,
  };
}

function storageUrl(bucket: string, path = "") {
  const { supabaseUrl } = getSupabaseAdminConfig();
  return `${supabaseUrl}/storage/v1/object/${bucket}${path ? `/${path}` : ""}`;
}

function adminStorageHeaders(extra: Record<string, string> = {}) {
  const { serviceRoleKey } = getSupabaseAdminConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

function encoded(value: string) {
  return encodeURIComponent(value);
}

export function isValidSubmissionKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

export async function findDraftByTokenHash(tokenHash: string) {
  const rows = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    `/rest/v1/public_disease_triage_drafts?token_hash=eq.${encoded(tokenHash)}&select=*&limit=1`,
    { method: "GET" },
  );
  return rows[0] ?? null;
}

export async function findDraftBySubmissionKey(submissionKey: string) {
  const rows = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    `/rest/v1/public_disease_triage_drafts?submission_key=eq.${encoded(submissionKey)}&select=*&limit=1`,
    { method: "GET" },
  );
  return rows[0] ?? null;
}

export async function findCaseByDraftId(draftId: string) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/agronomic_cases?public_triage_draft_id=eq.${encoded(draftId)}&select=id&limit=1`,
    { method: "GET" },
  );
  return rows[0]?.id ?? null;
}

export async function uploadDraftAttachment(draftId: string, fileIndex: number, file: File, bytes: Uint8Array) {
  const mime = detectMimeFromBytes(bytes.subarray(0, 64));
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new Error("Formato de imagem não aceito.");
  }

  const path = `${draftId}/${String(fileIndex + 1).padStart(2, "0")}-${crypto.randomUUID()}.${mime === "image/jpeg" ? "jpg" : mime.slice("image/".length)}`;
  const response = await fetch(storageUrl(DISEASE_TRIAGE_DRAFT_BUCKET, path), {
    method: "POST",
    headers: adminStorageHeaders({
      "Content-Type": mime,
      "x-upsert": "false",
      "cache-control": "private, max-age=0, no-store",
    }),
    body: Buffer.from(bytes),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Falha ao armazenar a imagem (${response.status}).`);
  }

  return {
    path,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    original_name: sanitizeDisplayFileName(file.name, `imagem-${fileIndex + 1}`),
  } satisfies DiseaseTriageDraftAttachment;
}

export async function downloadDraftAttachment(path: string) {
  const response = await fetch(storageUrl(DISEASE_TRIAGE_DRAFT_BUCKET, path), {
    method: "GET",
    headers: adminStorageHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Falha ao recuperar uma imagem temporária (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteDraftStorageObjects(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return;

  await fetch(storageUrl(DISEASE_TRIAGE_DRAFT_BUCKET), {
    method: "DELETE",
    headers: adminStorageHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: unique }),
    cache: "no-store",
  }).catch(() => undefined);
}

export async function deleteDraftRow(draftId: string) {
  await supabaseAdminRequest(
    `/rest/v1/public_disease_triage_drafts?id=eq.${encoded(draftId)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
}

export async function updateDraft(draftId: string, patch: Record<string, unknown>) {
  const rows = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    `/rest/v1/public_disease_triage_drafts?id=eq.${encoded(draftId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  return rows[0] ?? null;
}

/**
 * Reserva o rascunho para uma única promoção. O filtro faz parte do UPDATE,
 * portanto duas requisições simultâneas não conseguem criar dois casos.
 */
export async function claimDraft(draftId: string, userId: string) {
  const base = `/rest/v1/public_disease_triage_drafts?id=eq.${encoded(draftId)}&status=eq.pending`;
  const anonymousClaim = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    `${base}&user_id=is.null&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing", user_id: userId }),
    },
  );
  if (anonymousClaim[0]) return anonymousClaim[0];

  const ownedClaim = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    `${base}&user_id=eq.${encoded(userId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing" }),
    },
  );
  return ownedClaim[0] ?? null;
}

export async function createDraft(input: {
  draftId: string;
  tokenHash: string;
  submissionKey: string;
  form: DiseaseTriageForm;
  attachments: DiseaseTriageDraftAttachment[];
}) {
  const rows = await supabaseAdminRequest<DiseaseTriageDraftRow[]>(
    "/rest/v1/public_disease_triage_drafts?select=*",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: input.draftId,
        token_hash: input.tokenHash,
        submission_key: input.submissionKey,
        form_data: input.form,
        attachments: input.attachments,
        status: "pending",
        expires_at: new Date(Date.now() + DISEASE_TRIAGE_DRAFT_TTL_SECONDS * 1000).toISOString(),
      }),
    },
  );
  return rows[0] ?? null;
}

export async function consumeDiseaseDraftRateLimit(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const salt = process.env.RATE_LIMIT_SALT || process.env.NEXT_PUBLIC_SUPABASE_URL || "plantasa";
  const keyHash = crypto.createHash("sha256").update(`${salt}:disease-triage:${address}`).digest("hex");

  try {
    const result = await supabaseAdminRequest<boolean>(
      "/rest/v1/rpc/consume_public_form_rate_limit",
      {
        method: "POST",
        body: JSON.stringify({
          p_bucket: "disease-triage-drafts",
          p_key_hash: keyHash,
          p_limit: 10,
          p_window_seconds: 60 * 60,
        }),
      },
    );
    return result !== false;
  } catch (error) {
    // A migration ausente não deve ser confundida com uma negativa de limite;
    // o erro fica no log e as demais validações continuam protegendo o fluxo.
    console.warn("[disease-triage] rate limit indisponível", error instanceof Error ? error.message : error);
    return true;
  }
}

export async function cleanupExpiredDiseaseDrafts() {
  const rows = await supabaseAdminRequest<Array<{ id: string; attachments: DiseaseTriageDraftAttachment[] | null }>>(
    `/rest/v1/public_disease_triage_drafts?expires_at=lt.${encoded(new Date().toISOString())}&status=neq.completed&select=id,attachments&limit=20`,
    { method: "GET" },
  ).catch(() => []);

  for (const row of rows) {
    await deleteDraftStorageObjects((row.attachments ?? []).map((item) => item.path));
    await supabaseAdminRequest(
      `/rest/v1/public_disease_triage_drafts?id=eq.${encoded(row.id)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    ).catch(() => undefined);
  }
}

export { DISEASE_TRIAGE_COOKIE };

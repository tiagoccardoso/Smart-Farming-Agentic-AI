/**
 * Anexos (imagens e audio) dos formularios publicos.
 *
 *   * Validacao no servidor: quantidade, tamanho individual, tamanho total e
 *     formato REAL do arquivo (assinatura binaria), independente do MIME ou da
 *     extensao informados pelo navegador.
 *   * Armazenamento em bucket PRIVADO via service role. O caminho e gerado pelo
 *     servidor; o nome original e guardado apenas para exibicao.
 *   * Acesso somente por URL assinada de curta duracao (area administrativa).
 */

import crypto from "node:crypto";
import {
  ATTACHMENT_LIMITS,
  EXTENSION_BY_MIME,
  PUBLIC_REQUEST_ATTACHMENTS_BUCKET,
  detectMimeFromBytes,
  formatBytes,
  kindOfMime,
  sanitizeDisplayFileName,
  type AttachmentKind,
  type StoredAttachment
} from "../../public-requests/config";
import { getSupabaseAdminConfig } from "../supabaseAdmin";

export class AttachmentError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttachmentError";
    this.status = status;
  }
}

export type ValidatedAttachment = {
  kind: AttachmentKind;
  bytes: Uint8Array;
  mimeType: string;
  originalName: string;
  durationSeconds: number | null;
};

type AttachmentInput = {
  images: File[];
  audios: File[];
  /** Duracao informada pelo navegador (apenas informativa; o limite real e o tamanho). */
  audioDurationSeconds?: string | null;
};

function parseDuration(value: string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

async function validateOne(file: File, expected: AttachmentKind, index: number) {
  const label = expected === "image" ? `A imagem ${index + 1}` : "O áudio";
  const maxBytes = expected === "image" ? ATTACHMENT_LIMITS.maxImageBytes : ATTACHMENT_LIMITS.maxAudioBytes;

  if (file.size <= 0) {
    throw new AttachmentError(`${label} está vazio(a).`);
  }

  if (file.size > maxBytes) {
    throw new AttachmentError(`${label} excede o limite de ${formatBytes(maxBytes)}.`, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectMimeFromBytes(bytes.subarray(0, 64));

  if (!mimeType || kindOfMime(mimeType) !== expected) {
    throw new AttachmentError(
      expected === "image"
        ? `${label} não está em um formato aceito (JPG, PNG ou WEBP).`
        : "O áudio não está em um formato aceito (WEBM, OGG, M4A, MP3 ou WAV)."
    );
  }

  return {
    kind: expected,
    bytes,
    mimeType,
    originalName: sanitizeDisplayFileName(file.name, expected === "image" ? `imagem-${index + 1}` : "audio"),
    durationSeconds: null
  } satisfies ValidatedAttachment;
}

export async function validateAttachments(input: AttachmentInput): Promise<ValidatedAttachment[]> {
  if (input.images.length > ATTACHMENT_LIMITS.maxImages) {
    throw new AttachmentError(`Envie no máximo ${ATTACHMENT_LIMITS.maxImages} imagens.`);
  }

  if (input.audios.length > ATTACHMENT_LIMITS.maxAudioFiles) {
    throw new AttachmentError("Envie apenas um áudio por solicitação.");
  }

  const total = [...input.images, ...input.audios].reduce((sum, file) => sum + file.size, 0);
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
    throw new AttachmentError(`Os anexos somam mais de ${formatBytes(ATTACHMENT_LIMITS.maxTotalBytes)}. Remova algum arquivo.`, 413);
  }

  const validated: ValidatedAttachment[] = [];

  for (const [index, file] of input.images.entries()) {
    validated.push(await validateOne(file, "image", index));
  }

  for (const [index, file] of input.audios.entries()) {
    const audio = await validateOne(file, "audio", index);
    const duration = parseDuration(input.audioDurationSeconds);

    if (duration !== null && duration > ATTACHMENT_LIMITS.maxAudioSeconds + 5) {
      throw new AttachmentError(`O áudio deve ter no máximo ${Math.round(ATTACHMENT_LIMITS.maxAudioSeconds / 60)} minutos.`);
    }

    validated.push({ ...audio, durationSeconds: duration });
  }

  return validated;
}

function storageUrl(path: string) {
  const { supabaseUrl } = getSupabaseAdminConfig();
  return `${supabaseUrl}/storage/v1/${path}`;
}

function adminHeaders(extra: Record<string, string> = {}) {
  const { serviceRoleKey } = getSupabaseAdminConfig();
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...extra };
}

export function buildAttachmentPath(source: string, requestId: string, attachment: Pick<ValidatedAttachment, "kind" | "mimeType">, index: number, now = new Date()) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const extension = EXTENSION_BY_MIME[attachment.mimeType] ?? "bin";
  const safeSource = source.replace(/[^a-z0-9_-]/gi, "") || "solicitacao";
  return `${safeSource}/${month}/${requestId}/${attachment.kind}-${index + 1}-${crypto.randomUUID()}.${extension}`;
}

export async function deleteStoredAttachments(paths: string[]) {
  if (paths.length === 0) return;

  try {
    await fetch(storageUrl(`object/${PUBLIC_REQUEST_ATTACHMENTS_BUCKET}`), {
      method: "DELETE",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
      cache: "no-store"
    });
  } catch {
    console.warn("[public-requests] nao foi possivel remover anexos orfaos.", { count: paths.length });
  }
}

/** Envia os anexos ja validados. Em caso de falha parcial, remove o que foi enviado. */
export async function uploadAttachments(source: string, requestId: string, attachments: ValidatedAttachment[]): Promise<StoredAttachment[]> {
  if (attachments.length === 0) return [];

  const planned = attachments.map((attachment, index) => ({ attachment, path: buildAttachmentPath(source, requestId, attachment, index) }));

  const results = await Promise.allSettled(
    planned.map(async ({ attachment, path }) => {
      const response = await fetch(storageUrl(`object/${PUBLIC_REQUEST_ATTACHMENTS_BUCKET}/${path}`), {
        method: "POST",
        headers: adminHeaders({ "Content-Type": attachment.mimeType, "x-upsert": "false", "cache-control": "private, max-age=0" }),
        body: Buffer.from(attachment.bytes),
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`storage_upload_failed_${response.status}`);
      }

      return path;
    })
  );

  const failed = results.some((result) => result.status === "rejected");

  if (failed) {
    const uploaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    await deleteStoredAttachments(uploaded);
    console.error("[public-requests] falha ao armazenar anexos.", {
      reasons: results.flatMap((result) => (result.status === "rejected" ? [String((result.reason as Error)?.message ?? "erro")] : []))
    });
    throw new AttachmentError("Não foi possível armazenar os anexos agora. Tente novamente em instantes.", 502);
  }

  return planned.map(({ attachment, path }) => ({
    kind: attachment.kind,
    path,
    mime_type: attachment.mimeType,
    size_bytes: attachment.bytes.byteLength,
    original_name: attachment.originalName,
    duration_seconds: attachment.durationSeconds
  }));
}

export type SignedAttachment = Omit<StoredAttachment, "path"> & { url: string | null };

/** URLs assinadas de curta duracao (padrao: 10 minutos) para a area administrativa. */
export async function signAttachments(attachments: StoredAttachment[], expiresIn = 600): Promise<SignedAttachment[]> {
  const valid = attachments.filter((item) => item && typeof item.path === "string" && item.path);
  if (valid.length === 0) return [];

  const { supabaseUrl } = getSupabaseAdminConfig();
  const response = await fetch(storageUrl(`object/sign/${PUBLIC_REQUEST_ATTACHMENTS_BUCKET}`), {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn, paths: valid.map((item) => item.path) }),
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as Array<{ path?: string; signedURL?: string | null; error?: string | null }> | null;

  if (!response.ok || !Array.isArray(payload)) {
    throw new AttachmentError("Não foi possível gerar o acesso aos anexos.", 502);
  }

  const byPath = new Map(payload.map((item) => [item.path, item.signedURL]));

  return valid.map(({ path, ...rest }) => {
    const signed = byPath.get(path);
    return { ...rest, url: signed ? `${supabaseUrl}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}` : null };
  });
}

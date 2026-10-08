/**
 * Regras compartilhadas (navegador + servidor) dos anexos de casos agronômicos.
 * Sem dependências de servidor: pode ser importado por componentes cliente.
 */

export const CASE_STORAGE_BUCKET = "agronomic-cases";

const MB = 1024 * 1024;

/**
 * Corpo máximo de uma requisição às rotas de caso. As funções serverless da
 * Vercel recusam corpos acima de 4,5 MB antes de o código rodar (HTTP 413 sem
 * JSON), por isso cada upload vai em uma requisição própria e abaixo desse teto.
 */
export const MAX_REQUEST_BODY_BYTES = 4.3 * MB;

export const CASE_ATTACHMENT_LIMITS = {
  /** Foto já otimizada no navegador. HEIC sem conversão também precisa caber. */
  maxPhotoBytes: 4 * MB,
  maxSoilAnalysisBytes: 4 * MB,
  maxAudioBytes: 2.5 * MB,
  maxAudioSeconds: 180,
  /** Fotos enviadas de uma vez no chat. */
  maxChatImages: 4,
  maxChatImagesTotalBytes: 4 * MB,
  /** Fotos novas por edição (cada uma sobe em requisição própria). */
  maxPhotosPerEdit: 12,
} as const;

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
export const SOIL_ANALYSIS_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
export const AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
];
export const AUDIO_EXTENSIONS = ["webm", "ogg", "oga", "opus", "m4a", "mp4", "aac", "mp3", "wav"];

export const PHOTO_INPUT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
export const SOIL_INPUT_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export type CaseAttachmentKind = "photo" | "soil_analysis";

export function sanitizeStorageFileName(fileName: string) {
  return (
    fileName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(-80) || "arquivo"
  );
}

const UPLOAD_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

export function isValidClientUploadId(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

/**
 * Caminho determinístico de um anexo. O mesmo `clientUploadId` sempre gera o
 * mesmo caminho: se a rede cair depois do upload e o usuário tentar de novo, o
 * storage responde "já existe" e o anexo não é duplicado.
 */
export function buildCaseAttachmentPath(input: {
  userId: string;
  caseId: string;
  kind: CaseAttachmentKind | "chat_image" | "chat_audio";
  clientUploadId: string;
  fileName: string;
}) {
  const folder = {
    photo: "photos",
    soil_analysis: "soil",
    chat_image: "chat/images",
    chat_audio: "chat/audio",
  }[input.kind];
  return `${input.userId}/${input.caseId}/${folder}/${input.clientUploadId}-${sanitizeStorageFileName(input.fileName)}`;
}

export function publicStorageUrl(supabaseUrl: string, path: string, bucket = CASE_STORAGE_BUCKET) {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}

/** Extrai o caminho no bucket a partir da URL salva (pública ou autenticada). */
export function extractCaseStoragePath(url: string | null | undefined, bucket = CASE_STORAGE_BUCKET) {
  if (!url) return null;
  for (const marker of [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/${bucket}/`]) {
    const index = url.indexOf(marker);
    if (index >= 0) {
      const rest = url.slice(index + marker.length).split("?")[0];
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    }
  }
  return null;
}

/** O caminho pertence à pasta do usuário e do caso? (defesa contra IDs forjados) */
export function storagePathBelongsToCase(path: string | null, userId: string, caseId: string) {
  return Boolean(path && path.startsWith(`${userId}/${caseId}/`));
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

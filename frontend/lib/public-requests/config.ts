/**
 * Formularios publicos de Contato e Solicitacao de Orcamento.
 *
 * Configuracao compartilhada entre cliente e servidor (sem dependencias de
 * servidor): limites de anexos, formatos aceitos e deteccao de formato pelo
 * conteudo do arquivo (assinatura/"magic bytes"). O servidor SEMPRE revalida;
 * as verificacoes no navegador existem apenas para dar feedback imediato.
 */

import { QUOTE_SOURCE } from "../service-quotes";

export const PUBLIC_REQUEST_SOURCES = {
  /** Formulario de Contato (valor historico/default da coluna `source`). */
  contact: "agendamento",
  /** Solicitacao de Orcamento (Presencial & Projetos Especiais). */
  quote: QUOTE_SOURCE
} as const;

export type PublicRequestSource = (typeof PUBLIC_REQUEST_SOURCES)[keyof typeof PUBLIC_REQUEST_SOURCES];

export const PUBLIC_REQUEST_SOURCE_LABELS: Record<string, string> = {
  agendamento: "Contato",
  orcamento: "Solicitação de orçamento"
};

export const PUBLIC_REQUEST_ATTACHMENTS_BUCKET = "public-request-attachments";

const MB = 1024 * 1024;

export const ATTACHMENT_LIMITS = {
  maxImages: 4,
  /** Tamanho maximo de cada imagem ja otimizada no navegador. */
  maxImageBytes: 1.5 * MB,
  /** Tamanho maximo do arquivo escolhido antes da otimizacao no navegador. */
  maxImageSourceBytes: 15 * MB,
  maxAudioFiles: 1,
  maxAudioBytes: 2.5 * MB,
  maxAudioSeconds: 180,
  /** Soma de todos os anexos de uma solicitacao. */
  maxTotalBytes: 4 * MB,
  /**
   * Corpo maximo aceito pela rota (anexos + campos). Mantido abaixo do limite
   * de 4,5 MB de corpo das funcoes serverless da Vercel.
   */
  maxRequestBytes: 4.4 * MB
} as const;

export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_AUDIO_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;

/** Valor do atributo `accept` dos inputs (HEIC/HEIF sao convertidos para JPEG no navegador). */
export const IMAGE_INPUT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
export const AUDIO_INPUT_ACCEPT = "audio/webm,audio/ogg,audio/mp4,audio/x-m4a,audio/mpeg,audio/mp3,audio/wav,.webm,.ogg,.oga,.opus,.m4a,.mp4,.mp3,.wav";

export const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav"
};

export type AttachmentKind = "image" | "audio";

/** Registro persistido em specialist_visit_requests.attachments. */
export type StoredAttachment = {
  kind: AttachmentKind;
  path: string;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  duration_seconds: number | null;
};

function ascii(bytes: Uint8Array, start: number, end: number) {
  let text = "";
  for (let index = start; index < Math.min(end, bytes.length); index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

/**
 * Identifica o formato real pelos primeiros bytes do arquivo. Retorna "" quando
 * o conteudo nao corresponde a nenhum formato aceito.
 */
export function detectMimeFromBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") {
    const format = ascii(bytes, 8, 12);
    if (format === "WEBP") return "image/webp";
    if (format === "WAVE") return "audio/wav";
    return "";
  }

  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "audio/ogg";

  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 32));
    // Imagens HEIC/AVIF tambem usam "ftyp": nao sao aceitas como audio.
    if (/heic|heix|hevc|hevx|mif1|msf1|avif/i.test(brands)) return "";
    return "audio/mp4";
  }

  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return "audio/mpeg";

  return "";
}

export function kindOfMime(mime: string): AttachmentKind | null {
  if ((ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return "image";
  if ((ACCEPTED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) return "audio";
  return null;
}

/** Nome apenas para exibicao: nunca e usado para montar caminhos no storage. */
export function sanitizeDisplayFileName(name: string, fallback = "arquivo") {
  const cleaned = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-80);
  return cleaned || fallback;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

export function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Chave de idempotencia gerada pelo navegador para cada rascunho de envio. */
export function isValidSubmissionKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

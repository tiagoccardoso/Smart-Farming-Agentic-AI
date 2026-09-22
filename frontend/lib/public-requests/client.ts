/**
 * Utilitarios de navegador dos formularios publicos: otimizacao de imagens,
 * gravacao/leitura de audio, envio com progresso e chamada ao assistente de IA.
 */

import { ATTACHMENT_LIMITS, detectMimeFromBytes, formatBytes, kindOfMime, sanitizeDisplayFileName } from "./config";

export function createSubmissionKey(prefix: string) {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export async function detectFileMime(file: Blob) {
  try {
    return detectMimeFromBytes(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  } catch {
    return "";
  }
}

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode_failed"));
    };
    image.src = url;
  });
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Alguns navegadores so decodificam certos formatos via <img> (ex.: HEIC no Safari).
    }
  }

  const image = await loadImageElement(file);
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Reduz dimensoes e peso da imagem e remove metadados (ex.: localizacao GPS do
 * EXIF), recodificando em JPEG. PNG/WEBP pequenos sao mantidos como estao.
 */
export async function optimizeImageFile(file: File): Promise<File> {
  const displayName = sanitizeDisplayFileName(file.name, "imagem");

  if (file.size > ATTACHMENT_LIMITS.maxImageSourceBytes) {
    throw new Error(`"${displayName}" é muito grande (máximo de ${formatBytes(ATTACHMENT_LIMITS.maxImageSourceBytes)}).`);
  }

  const sniffed = await detectFileMime(file);

  if ((sniffed === "image/png" || sniffed === "image/webp") && file.size <= ATTACHMENT_LIMITS.maxImageBytes) {
    return file;
  }

  let decoded: Awaited<ReturnType<typeof decodeImage>>;

  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error(`Não foi possível ler "${displayName}". Envie a imagem em JPG, PNG ou WEBP.`);
  }

  try {
    const attempts = [
      { maxSide: 1920, quality: 0.85 },
      { maxSide: 1600, quality: 0.75 },
      { maxSide: 1280, quality: 0.65 }
    ];

    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxSide / Math.max(decoded.width, decoded.height, 1));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) break;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/jpeg", attempt.quality);

      if (blob && blob.size <= ATTACHMENT_LIMITS.maxImageBytes) {
        const baseName = displayName.replace(/\.[^.]+$/, "") || "imagem";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      }
    }
  } finally {
    decoded.close();
  }

  throw new Error(`Não foi possível reduzir "${displayName}" para até ${formatBytes(ATTACHMENT_LIMITS.maxImageBytes)}.`);
}

export function isAudioRecordingSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Formato de gravacao suportado pelo navegador (Chrome/Firefox: webm/ogg; Safari: mp4). */
export function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

export function audioExtensionFor(mime: string) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/** Duracao do audio em segundos, quando o navegador consegue informar. */
export function readAudioDuration(file: Blob, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    audio.src = url;
  });
}

export async function validateAudioFile(file: File) {
  if (file.size > ATTACHMENT_LIMITS.maxAudioBytes) {
    throw new Error(`O áudio excede o limite de ${formatBytes(ATTACHMENT_LIMITS.maxAudioBytes)}. Grave uma mensagem mais curta.`);
  }

  const mime = await detectFileMime(file);
  if (kindOfMime(mime) !== "audio") {
    throw new Error("Formato de áudio não aceito. Use WEBM, OGG, M4A, MP3 ou WAV.");
  }

  const duration = await readAudioDuration(file);
  if (duration !== null && duration > ATTACHMENT_LIMITS.maxAudioSeconds + 1) {
    throw new Error(`O áudio deve ter no máximo ${Math.round(ATTACHMENT_LIMITS.maxAudioSeconds / 60)} minutos.`);
  }

  return { mime, duration };
}

export type PostResult = { ok: boolean; status: number; payload: Record<string, unknown> | null };

export class RequestTransportError extends Error {
  kind: "network" | "timeout";

  constructor(kind: "network" | "timeout") {
    super(kind);
    this.name = "RequestTransportError";
    this.kind = kind;
  }
}

/** POST multipart com progresso de upload (fetch nao expoe progresso de envio). */
export function postFormWithProgress(
  url: string,
  body: FormData,
  options: { headers?: Record<string, string>; onProgress?: (fraction: number) => void; timeoutMs?: number } = {}
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = options.timeoutMs ?? 120000;
    xhr.withCredentials = true;
    Object.entries(options.headers ?? {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) options.onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, payload });
    };
    xhr.onerror = () => reject(new RequestTransportError("network"));
    xhr.ontimeout = () => reject(new RequestTransportError("timeout"));
    xhr.send(body);
  });
}

export async function requestAiSuggestion(body: Record<string, unknown>, timeoutMs = 60000): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/public-requests/ai-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
    const payload = (await response.json().catch(() => null)) as { suggestion?: unknown; error?: unknown } | null;

    if (!response.ok || typeof payload?.suggestion !== "string" || !payload.suggestion.trim()) {
      throw new Error(
        typeof payload?.error === "string" && payload.error
          ? payload.error
          : "O assistente de IA está indisponível no momento. Você pode escrever e enviar normalmente."
      );
    }

    return payload.suggestion;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error("A IA demorou mais que o esperado. Tente novamente ou envie sua mensagem normalmente.");
    }
    if (error instanceof TypeError) {
      throw new Error("Sem conexão com o servidor. Verifique sua internet e tente novamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

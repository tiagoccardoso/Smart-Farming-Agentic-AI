/**
 * Leitura do corpo dos formularios publicos.
 *
 * Aceita multipart/form-data (campos + anexos) e, por compatibilidade, JSON
 * (somente campos). O tamanho declarado e verificado ANTES de ler o corpo.
 */

import { ATTACHMENT_LIMITS, formatBytes } from "../../public-requests/config";

export class RequestBodyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export type PublicRequestBody = {
  fields: Record<string, string>;
  images: File[];
  audios: File[];
};

const MAX_FIELD_LENGTH = 8000;

function isFileEntry(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

export async function readPublicRequestBody(request: Request): Promise<PublicRequestBody> {
  const declaredLength = Number(request.headers.get("content-length") || 0);

  if (declaredLength > ATTACHMENT_LIMITS.maxRequestBytes) {
    throw new RequestBodyError(
      `O envio excede o limite total de ${formatBytes(ATTACHMENT_LIMITS.maxTotalBytes)} em anexos. Remova algum arquivo e tente novamente.`,
      413
    );
  }

  const contentType = request.headers.get("content-type") || "";
  const fields: Record<string, string> = {};
  const images: File[] = [];
  const audios: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      throw new RequestBodyError("Não foi possível ler os dados enviados. Tente novamente.");
    }

    form.forEach((value, key) => {
      if (isFileEntry(value)) {
        if (value.size === 0) return;
        if (key === "images") images.push(value);
        else if (key === "audio") audios.push(value);
        return;
      }

      if (!(key in fields)) {
        fields[key] = String(value).slice(0, MAX_FIELD_LENGTH);
      }
    });

    return { fields, images, audios };
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (!payload || typeof payload !== "object") {
    throw new RequestBodyError("Envie os dados da solicitação.");
  }

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[key] = String(value).slice(0, MAX_FIELD_LENGTH);
    }
  }

  return { fields, images, audios };
}

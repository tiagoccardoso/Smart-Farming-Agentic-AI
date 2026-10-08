/**
 * Preparação de arquivos no navegador para os casos agronômicos.
 *
 * Fotos de celular costumam ter 3 a 8 MB; sem compactação elas estouram o
 * limite de corpo da Vercel (4,5 MB). A otimização mantém até 1920 px no maior
 * lado (detalhe suficiente para lesões, manchas e pragas) e remove metadados
 * como localização GPS.
 */

import { optimizeImageFile } from "../public-requests/client";
import { getNormalizedUploadFileType } from "../mobile-image-upload";
import { CASE_ATTACHMENT_LIMITS } from "./case-attachments";

export function createClientId(prefix = "up") {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`.slice(0, 64);
}

/** Compacta a foto; HEIC que o navegador não decodifica segue original se couber. */
export async function prepareCasePhoto(file: File): Promise<File> {
  try {
    return await optimizeImageFile(file);
  } catch (error) {
    const type = await getNormalizedUploadFileType(file);
    if ((type === "image/heic" || type === "image/heif") && file.size <= CASE_ATTACHMENT_LIMITS.maxPhotoBytes) {
      return file;
    }
    throw error;
  }
}

/** Análise de solo: PDF segue como está (com limite); imagem é compactada. */
export async function prepareSoilAnalysis(file: File): Promise<File> {
  const type = await getNormalizedUploadFileType(file);
  if (type === "application/pdf") {
    if (file.size > CASE_ATTACHMENT_LIMITS.maxSoilAnalysisBytes) {
      throw new Error("O PDF da análise de solo passa de 4 MB. Envie uma versão menor ou fotografe o laudo.");
    }
    return file;
  }
  if (type === "image/jpeg" || type === "image/png") return prepareCasePhoto(file);
  throw new Error("Envie a análise de solo em PDF, JPG ou PNG.");
}

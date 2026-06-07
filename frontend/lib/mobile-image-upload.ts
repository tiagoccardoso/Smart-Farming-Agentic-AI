export const GENERIC_MOBILE_FILE_TYPES = ["", "application/octet-stream"];

export function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function normalizeMimeType(type: string | null | undefined) {
  const normalizedType = (type ?? "").trim().toLowerCase();

  if (normalizedType === "image/jpg" || normalizedType === "image/pjpeg") {
    return "image/jpeg";
  }

  if (normalizedType === "image/x-png") {
    return "image/png";
  }

  if (normalizedType === "image/heic-sequence") {
    return "image/heic";
  }

  if (normalizedType === "image/heif-sequence") {
    return "image/heif";
  }

  return normalizedType;
}

export function getMimeTypeFromExtension(fileName: string) {
  const extension = getFileExtension(fileName);
  const typeByExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };

  return typeByExtension[extension] ?? "";
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export async function sniffFileMimeType(file: File) {
  try {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());

    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return "image/jpeg";
    }

    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }

    if (
      bytes.length >= 12 &&
      bytesToAscii(bytes, 0, 4) === "RIFF" &&
      bytesToAscii(bytes, 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }

    if (bytes.length >= 5 && bytesToAscii(bytes, 0, 5) === "%PDF-") {
      return "application/pdf";
    }

    if (bytes.length >= 12 && bytesToAscii(bytes, 4, 8) === "ftyp") {
      const brandArea = bytesToAscii(bytes, 8, Math.min(bytes.length, 64));

      if (/heic|heix|hevc|hevx/i.test(brandArea)) {
        return "image/heic";
      }

      if (/heif|mif1|msf1/i.test(brandArea)) {
        return "image/heif";
      }
    }
  } catch {
    return "";
  }

  return "";
}

export async function getNormalizedUploadFileType(file: File) {
  const normalizedType = normalizeMimeType(file.type);

  if (
    normalizedType &&
    normalizedType !== "application/octet-stream" &&
    (normalizedType.startsWith("image/") ||
      normalizedType === "application/pdf")
  ) {
    return normalizedType;
  }

  const extensionType = getMimeTypeFromExtension(file.name);
  if (GENERIC_MOBILE_FILE_TYPES.includes(normalizedType) && extensionType) {
    return extensionType;
  }

  return (await sniffFileMimeType(file)) || normalizedType;
}

export async function isAllowedUploadFile(
  file: File,
  allowedTypes: string[],
  allowedExtensions: string[],
) {
  const allowedTypeSet = new Set(allowedTypes.map(normalizeMimeType));
  const extension = getFileExtension(file.name);
  const hasAllowedExtension = allowedExtensions.includes(extension);
  const normalizedType = normalizeMimeType(file.type);

  if (allowedTypeSet.has(normalizedType)) {
    return true;
  }

  const hasGenericMobileType =
    GENERIC_MOBILE_FILE_TYPES.includes(normalizedType);
  const extensionType = getMimeTypeFromExtension(file.name);
  if (
    hasAllowedExtension &&
    hasGenericMobileType &&
    extensionType &&
    allowedTypeSet.has(extensionType)
  ) {
    return true;
  }

  const sniffedType = await sniffFileMimeType(file);
  return Boolean(sniffedType && allowedTypeSet.has(sniffedType));
}

export async function getSafeUploadContentType(
  file: File,
  fallback = "application/octet-stream",
) {
  const normalizedType = await getNormalizedUploadFileType(file);
  return normalizedType && normalizedType !== "application/octet-stream"
    ? normalizedType
    : fallback;
}

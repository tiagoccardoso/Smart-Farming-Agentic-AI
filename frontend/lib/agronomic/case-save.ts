/**
 * Orquestra o salvamento da edição de um caso (navegador), sem dependência de
 * React para poder ser testado.
 *
 * Ordem: 1) textos/propriedade/remoções (PATCH) → 2) cada anexo em requisição
 * própria → 3) releitura do caso no servidor e conferência do que persistiu.
 * "Salvo com sucesso" só é devolvido quando a releitura confirma tudo.
 * Em falha, o que não foi salvo continua pendente para "Tentar novamente";
 * anexos já enviados não são reenviados (e o servidor é idempotente).
 */

export type EditableCaseFields = {
  crop: string;
  farmName: string;
  city: string;
  state: string;
  areaHectares: string;
  soilType: string;
  growthStage: string;
  symptoms: string;
  managementHistory: string;
};

export const EMPTY_EDIT_FIELDS: EditableCaseFields = {
  crop: "",
  farmName: "",
  city: "",
  state: "",
  areaHectares: "",
  soilType: "",
  growthStage: "",
  symptoms: "",
  managementHistory: "",
};

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export type PendingUpload = {
  /** Também é o clientUploadId enviado ao servidor (idempotência). */
  id: string;
  kind: "photo" | "soil_analysis";
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string | null;
  /** id em case_images depois do envio (fotos). */
  savedImageId?: string | null;
  savedUrl?: string | null;
};

export type TransportResult = { ok: boolean; status: number; payload: Record<string, unknown> | null };

export type ReloadedCase = {
  crop?: string | null;
  symptoms?: string | null;
  growth_stage?: string | null;
  history?: string | null;
  soil_analysis_url?: string | null;
  farm?: { name?: string | null; city?: string | null; state?: string | null; area_hectares?: number | null; soil_type?: string | null } | null;
  images?: Array<{ id: string; image_url: string }>;
};

export type SaveTransport = {
  patchCase: (body: EditableCaseFields & { removeImageIds: string[] }) => Promise<TransportResult>;
  uploadAttachment: (upload: PendingUpload, onProgress: (fraction: number) => void) => Promise<TransportResult>;
  reloadCase: () => Promise<ReloadedCase | null>;
};

export type SaveOutcome = {
  status: "saved" | "partial" | "error";
  message: string;
  contentSaved: boolean;
  uploads: PendingUpload[];
  fieldErrors?: Record<string, string>;
  reloadedCase: ReloadedCase | null;
};

function normalizeFieldValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function fieldsFromCase(caseData: ReloadedCase | null | undefined): EditableCaseFields {
  if (!caseData) return { ...EMPTY_EDIT_FIELDS };
  return {
    crop: caseData.crop ?? "",
    farmName: caseData.farm?.name ?? "",
    city: caseData.farm?.city ?? "",
    state: caseData.farm?.state ?? "",
    areaHectares: caseData.farm?.area_hectares ? String(caseData.farm.area_hectares) : "",
    soilType: caseData.farm?.soil_type ?? "",
    growthStage: caseData.growth_stage ?? "",
    symptoms: caseData.symptoms ?? "",
    managementHistory: caseData.history ?? "",
  };
}

export function changedFieldKeys(original: EditableCaseFields, current: EditableCaseFields) {
  return (Object.keys(original) as Array<keyof EditableCaseFields>).filter(
    (key) => normalizeFieldValue(original[key]) !== normalizeFieldValue(current[key]),
  );
}

export function hasUnsavedChanges(input: {
  original: EditableCaseFields;
  current: EditableCaseFields;
  uploads: PendingUpload[];
  removeImageIds: string[];
}) {
  return (
    changedFieldKeys(input.original, input.current).length > 0 ||
    input.removeImageIds.length > 0 ||
    input.uploads.some((upload) => upload.status !== "done")
  );
}

/** Campos que o servidor devolveu diferentes do que foi enviado. */
export function unconfirmedFields(sent: EditableCaseFields, reloaded: ReloadedCase) {
  const persisted = fieldsFromCase(reloaded);
  return changedFieldKeys(
    { ...sent, areaHectares: sent.areaHectares ? String(Number(sent.areaHectares.replace(",", "."))) : "" },
    { ...persisted, areaHectares: persisted.areaHectares ? String(Number(persisted.areaHectares)) : "" },
  );
}

function errorMessageFrom(result: TransportResult, fallback: string) {
  const message = result.payload && typeof result.payload.error === "string" ? result.payload.error : null;
  if (result.status === 413) return "Arquivo grande demais para envio. Escolha uma imagem menor.";
  if (result.status === 401) return message || "Sua sessão expirou. Faça login novamente; suas alterações continuam na tela.";
  if (result.status === 0) return "Sem conexão com o servidor. Verifique a internet e tente novamente.";
  return message || fallback;
}

export async function saveCaseChanges(options: {
  fields: EditableCaseFields;
  contentDirty: boolean;
  removeImageIds: string[];
  uploads: PendingUpload[];
  transport: SaveTransport;
  onUploadsChange?: (uploads: PendingUpload[]) => void;
}): Promise<SaveOutcome> {
  let uploads = options.uploads.map((upload) => ({ ...upload }));
  const publish = () => options.onUploadsChange?.(uploads.map((upload) => ({ ...upload })));
  let contentSaved = !options.contentDirty && options.removeImageIds.length === 0;

  if (!contentSaved) {
    let result: TransportResult;
    try {
      result = await options.transport.patchCase({ ...options.fields, removeImageIds: options.removeImageIds });
    } catch {
      result = { ok: false, status: 0, payload: null };
    }
    if (!result.ok) {
      return {
        status: "error",
        message: errorMessageFrom(result, "Não foi possível salvar. Tente novamente."),
        contentSaved: false,
        uploads,
        fieldErrors: (result.payload?.fieldErrors as Record<string, string> | undefined) ?? undefined,
        reloadedCase: null,
      };
    }
    contentSaved = true;
  }

  for (let index = 0; index < uploads.length; index += 1) {
    if (uploads[index].status === "done") continue;
    uploads[index] = { ...uploads[index], status: "uploading", progress: 0, error: null };
    publish();
    let result: TransportResult;
    try {
      result = await options.transport.uploadAttachment(uploads[index], (fraction) => {
        uploads[index] = { ...uploads[index], progress: Math.max(0, Math.min(1, fraction)) };
        publish();
      });
    } catch {
      result = { ok: false, status: 0, payload: null };
    }
    if (result.ok) {
      const image = result.payload?.image as { id?: string; image_url?: string } | null | undefined;
      uploads[index] = {
        ...uploads[index],
        status: "done",
        progress: 1,
        savedImageId: image?.id ?? null,
        savedUrl: image?.image_url ?? (typeof result.payload?.soilAnalysisUrl === "string" ? result.payload.soilAnalysisUrl : null),
      };
    } else {
      uploads[index] = { ...uploads[index], status: "error", error: errorMessageFrom(result, `Não foi possível enviar "${uploads[index].file.name}".`) };
    }
    publish();
  }

  const reloadedCase = await options.transport.reloadCase().catch(() => null);
  const failed = uploads.filter((upload) => upload.status === "error");

  if (!reloadedCase) {
    return {
      status: "error",
      message: "As alterações foram enviadas, mas não foi possível confirmar no servidor. Atualize a página para conferir.",
      contentSaved,
      uploads,
      reloadedCase: null,
    };
  }

  // Conferência: textos e anexos precisam aparecer na releitura do servidor.
  const notConfirmedFields = options.contentDirty ? unconfirmedFields(options.fields, reloadedCase) : [];
  const imageIds = new Set((reloadedCase.images ?? []).map((image) => image.id));
  const missingPhotos = uploads.filter((upload) => upload.status === "done" && upload.kind === "photo" && upload.savedImageId && !imageIds.has(upload.savedImageId));
  const stillListedRemovals = options.removeImageIds.filter((id) => imageIds.has(id));

  if (notConfirmedFields.length || missingPhotos.length || stillListedRemovals.length) {
    return {
      status: "error",
      message: "O servidor não confirmou todas as alterações. Nada foi descartado da tela; tente salvar novamente.",
      contentSaved: false,
      uploads: uploads.map((upload) => (missingPhotos.includes(upload) ? { ...upload, status: "error", error: "Envio não confirmado." } : upload)),
      reloadedCase,
    };
  }

  if (failed.length) {
    const sent = uploads.filter((upload) => upload.status === "done").length;
    return {
      status: "partial",
      message: `${contentSaved && options.contentDirty ? "Textos salvos. " : ""}${failed.length} de ${uploads.length} arquivo(s) não foram enviados${sent ? `; ${sent} enviado(s)` : ""}. Toque em "Tentar novamente" para reenviar só o que falhou.`,
      contentSaved,
      uploads,
      reloadedCase,
    };
  }

  return { status: "saved", message: "Alterações salvas com sucesso", contentSaved: true, uploads, reloadedCase };
}

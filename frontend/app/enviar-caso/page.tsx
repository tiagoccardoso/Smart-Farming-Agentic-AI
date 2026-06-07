"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import MobileImagePicker from "../../components/MobileImagePicker";
import {
  ApiRequestError,
  analyzeAgronomicCase,
  getAgronomicCase,
  submitAgronomicCase,
  updateAgronomicCase,
} from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "10MB";
const PHOTO_COMPRESSION_TRIGGER_BYTES = 4 * 1024 * 1024;
const PHOTO_COMPRESSION_TARGET_BYTES = 3 * 1024 * 1024;
const PHOTO_MAX_DIMENSION = 1920;
const PHOTO_COMPRESSION_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const ACCEPTED_PHOTO_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
];
const ACCEPTED_SOIL_ANALYSIS_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const GENERIC_MOBILE_FILE_TYPES = ["", "application/octet-stream"];

type PhotoPreview = {
  id: string;
  name: string;
  url: string;
  index: number;
};

const initialForm = {
  crop: "",
  city: "",
  state: "",
  farmName: "",
  areaHectares: "",
  soilType: "",
  growthStage: "",
  symptoms: "",
  managementHistory: "",
};

type FormState = typeof initialForm;
type RequiredField = "crop" | "state" | "symptoms";

type FormErrors = Partial<Record<keyof FormState, string>>;
type AttachmentError = {
  photos?: string;
  soilAnalysis?: string;
};

const requiredLabels: Record<RequiredField, string> = {
  crop: "Informe a cultura.",
  state: "Informe o estado.",
  symptoms: "Descreva os sintomas observados.",
};

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getNormalizedFileType(file: File) {
  const normalizedType = file.type.toLowerCase();

  if (normalizedType && normalizedType !== "application/octet-stream") {
    return normalizedType;
  }

  const extension = getFileExtension(file.name);
  const typeByExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };

  return typeByExtension[extension] ?? normalizedType;
}

function isAllowedMobileFile(
  file: File,
  allowedTypes: string[],
  allowedExtensions: string[],
) {
  const extension = getFileExtension(file.name);
  const hasAllowedExtension = allowedExtensions.includes(extension);
  const normalizedType = file.type.toLowerCase();
  const inferredType = getNormalizedFileType(file);

  if (
    allowedTypes.includes(normalizedType) ||
    allowedTypes.includes(inferredType)
  ) {
    return true;
  }

  return (
    hasAllowedExtension && GENERIC_MOBILE_FILE_TYPES.includes(normalizedType)
  );
}

function replaceFileExtension(fileName: string, extension: string) {
  const cleanName = fileName.replace(/\.[^/.]+$/, "");
  return `${cleanName || "foto-do-caso"}.${extension}`;
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = document.createElement("img");

    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error("Não foi possível ler a imagem selecionada."));
    };
    image.src = imageUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function compressPhotoForMobileUpload(file: File) {
  const normalizedType = getNormalizedFileType(file);

  if (
    file.size <= PHOTO_COMPRESSION_TRIGGER_BYTES ||
    !PHOTO_COMPRESSION_TYPES.includes(normalizedType)
  ) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const scale = Math.min(
      1,
      PHOTO_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) return file;

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    let quality = 0.82;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);

    while (
      blob &&
      blob.size > PHOTO_COMPRESSION_TARGET_BYTES &&
      quality > 0.55
    ) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], replaceFileExtension(file.name, "jpg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

function EnviarCasoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId")?.trim() ?? "";
  const isEditingExistingCase = Boolean(caseId);
  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<File[]>([]);
  const [soilAnalysis, setSoilAnalysis] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [attachmentErrors, setAttachmentErrors] = useState<AttachmentError>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExistingCase, setLoadingExistingCase] = useState(false);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [existingImages, setExistingImages] = useState<
    Array<{ id: string; image_url: string; created_at: string | null }>
  >([]);
  const [existingSoilAnalysisUrl, setExistingSoilAnalysisUrl] = useState<
    string | null
  >(null);

  const photoPreviews = useMemo<PhotoPreview[]>(
    () =>
      photos.map((file, index) => ({
        id: `${fileKey(file)}-${index}`,
        name: file.name,
        url: URL.createObjectURL(file),
        index,
      })),
    [photos],
  );

  useEffect(() => {
    return () => {
      photoPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [photoPreviews]);

  useEffect(() => {
    async function loadExistingCase() {
      if (!caseId) return;
      const accessToken = getStoredSupabaseAccessToken();
      if (!accessToken) {
        setSubmitError("Faça login para editar este caso agronômico.");
        return;
      }

      setLoadingExistingCase(true);
      setSubmitError(null);
      try {
        const payload = await getAgronomicCase(caseId, accessToken);
        const caseData = payload.case;
        setForm({
          crop: caseData.crop ?? "",
          city: caseData.farm?.city ?? "",
          state: caseData.farm?.state ?? "",
          farmName: caseData.farm?.name ?? "",
          areaHectares: caseData.farm?.area_hectares
            ? String(caseData.farm.area_hectares)
            : "",
          soilType: caseData.farm?.soil_type ?? "",
          growthStage: caseData.growth_stage ?? "",
          symptoms: caseData.symptoms ?? "",
          managementHistory: caseData.history ?? "",
        });
        setExistingImages(caseData.images ?? []);
        setExistingSoilAnalysisUrl(caseData.soil_analysis_url ?? null);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o caso existente.",
        );
      } finally {
        setLoadingExistingCase(false);
      }
    }

    loadExistingCase();
  }, [caseId]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));

    if (value.trim()) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const validateFile = (
    file: File,
    allowedTypes: string[],
    allowedExtensions: string[],
    label: string,
  ) => {
    if (!isAllowedMobileFile(file, allowedTypes, allowedExtensions)) {
      return `${label} "${file.name}" não está em um formato aceito.`;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${label} "${file.name}" excede o limite de ${MAX_FILE_SIZE_LABEL}.`;
    }

    return null;
  };

  const handlePhotosChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFiles = Array.from(input.files ?? []);

    if (selectedFiles.length === 0) return;

    setPreparingPhotos(true);
    setAttachmentErrors((prev) => ({ ...prev, photos: undefined }));

    try {
      const preparedFiles = await Promise.all(
        selectedFiles.map((file) => compressPhotoForMobileUpload(file)),
      );
      const invalidFileMessage = preparedFiles
        .map((file) =>
          validateFile(
            file,
            ACCEPTED_PHOTO_TYPES,
            ACCEPTED_PHOTO_EXTENSIONS,
            "A imagem",
          ),
        )
        .find(Boolean);

      if (invalidFileMessage) {
        setAttachmentErrors((prev) => ({
          ...prev,
          photos: invalidFileMessage,
        }));
        return;
      }

      setPhotos((currentPhotos) => {
        const currentKeys = new Set(currentPhotos.map(fileKey));
        const uniqueSelectedFiles = preparedFiles.filter((file) => {
          const key = fileKey(file);

          if (currentKeys.has(key)) return false;

          currentKeys.add(key);
          return true;
        });

        return [...currentPhotos, ...uniqueSelectedFiles];
      });
    } catch {
      setAttachmentErrors((prev) => ({
        ...prev,
        photos:
          "Não foi possível preparar a imagem selecionada. Tente escolher outra foto ou enviar o caso sem imagem.",
      }));
    } finally {
      setPreparingPhotos(false);
      input.value = "";
    }
  };

  const handleRemovePhoto = (indexToRemove: number) => {
    setPhotos((currentPhotos) =>
      currentPhotos.filter((_, index) => index !== indexToRemove),
    );
    setAttachmentErrors((prev) => ({ ...prev, photos: undefined }));
  };

  const handleSoilAnalysisChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      setSoilAnalysis(null);
      setAttachmentErrors((prev) => ({ ...prev, soilAnalysis: undefined }));
      return;
    }

    const invalidFileMessage = validateFile(
      selectedFile,
      ACCEPTED_SOIL_ANALYSIS_TYPES,
      ACCEPTED_SOIL_ANALYSIS_EXTENSIONS,
      "A análise de solo",
    );

    if (invalidFileMessage) {
      setSoilAnalysis(null);
      setAttachmentErrors((prev) => ({
        ...prev,
        soilAnalysis: invalidFileMessage,
      }));
      event.target.value = "";
      return;
    }

    setSoilAnalysis(selectedFile);
    setAttachmentErrors((prev) => ({ ...prev, soilAnalysis: undefined }));
  };

  const validate = () => {
    const nextErrors: FormErrors = {};

    (Object.keys(requiredLabels) as RequiredField[]).forEach((field) => {
      if (!form[field].trim()) {
        nextErrors[field] = requiredLabels[field];
      }
    });

    const areaValue = form.areaHectares.trim().replace(",", ".");

    if (areaValue) {
      const parsedArea = Number(areaValue);

      if (!Number.isFinite(parsedArea) || parsedArea <= 0) {
        nextErrors.areaHectares =
          "Informe uma área em hectares maior que zero.";
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading || loadingExistingCase || preparingPhotos) {
      return;
    }

    setSubmitError(null);
    setSuccessMessage(null);

    if (!validate()) {
      setSubmitError("Revise os campos destacados antes de enviar o caso.");
      return;
    }

    if (attachmentErrors.photos || attachmentErrors.soilAnalysis) {
      setSubmitError("Revise os arquivos selecionados antes de enviar.");
      return;
    }

    if (preparingPhotos) {
      setSubmitError("Aguarde a preparação da imagem antes de enviar o caso.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setSubmitError(
        "Faça login com Supabase antes de enviar o caso agronômico.",
      );
      return;
    }

    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    photos.forEach((photo) => formData.append("photos", photo));

    if (soilAnalysis) {
      formData.append("soilAnalysis", soilAnalysis);
    }

    setLoading(true);

    try {
      if (isEditingExistingCase) {
        await updateAgronomicCase(caseId, formData, accessToken);
        setSuccessMessage(
          "Caso atualizado. A IA está reprocessando os dados e novas imagens...",
        );
        await analyzeAgronomicCase(caseId, accessToken).catch(() => null);
        window.setTimeout(
          () => router.push(`/revisao-humana?caseId=${caseId}`),
          650,
        );
      } else {
        const response = await submitAgronomicCase(formData, accessToken);
        setSuccessMessage(
          "Caso salvo com sucesso. Redirecionando para a Consultoria IA...",
        );
        window.setTimeout(
          () => router.push(`/consultoria-ia?caseId=${response.caseId}`),
          650,
        );
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.fieldErrors) {
        setErrors((prev) => ({ ...prev, ...error.fieldErrors }));
      }

      setSubmitError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o caso. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <div className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
            Preparação do atendimento
          </p>
          <SectionTitle
            title={
              isEditingExistingCase ? "Atualizar caso existente" : "Enviar Caso"
            }
            subtitle={
              isEditingExistingCase
                ? "Edite informações, complemente histórico e anexe novas imagens sem criar outro caso."
                : "Envie dados da cultura, sintomas, fotos e análise de solo para abrir um caso agronômico."
            }
          />
          <p className="text-base leading-7 text-slate-700">
            {isEditingExistingCase
              ? "Você está atualizando o mesmo caseId. As imagens e conversas anteriores serão preservadas e a IA fará nova análise após salvar."
              : "O envio apenas registra o caso e organiza os anexos para a próxima etapa da consultoria. Nenhuma recomendação técnica é gerada nesta tela."}
          </p>
          <SafetyDisclaimer className="mt-5 bg-white/90" />
        </div>
      </div>

      <WorkflowStepper
        className="mt-8"
        steps={[
          {
            title: "Entrar",
            description: "Use sua conta para manter o caso salvo.",
            status: "done",
          },
          {
            title: "Enviar caso",
            description: "Preencha cultura, sintomas, histórico e anexos.",
            status: "current",
          },
          {
            title: "Consultoria IA",
            description: "Gere a pré-análise após o salvamento.",
            status: "next",
          },
          {
            title: "Revisão humana",
            description: "Pague a revisão se o risco for médio ou alto.",
            status: "next",
          },
          {
            title: "Meus relatórios",
            description: "Acompanhe o parecer final revisado.",
            status: "next",
          },
        ]}
      />

      {(loading || loadingExistingCase || preparingPhotos) && (
        <div className="mt-8">
          <LoadingCard
            title={
              loadingExistingCase
                ? "Carregando caso existente"
                : preparingPhotos
                  ? "Preparando imagem"
                  : "Salvando o caso agronômico"
            }
            description={
              loadingExistingCase
                ? "Estamos preenchendo a tela com os dados já salvos, imagens anteriores e anexos."
                : preparingPhotos
                  ? "Estamos ajustando a foto do celular para envio seguro. Não feche esta página."
                  : "Estamos validando os dados, enviando anexos e preparando a reanálise com segurança. Não feche esta página."
            }
            rows={4}
          />
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-8 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]"
      >
        <div className="space-y-6">
          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">
              Dados da propriedade e cultura
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Campos marcados com * são obrigatórios. Em modo de edição, o
              registro existente é atualizado sem gerar novo caseId.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <InputField
                label="Cultura *"
                name="crop"
                type="text"
                placeholder="Ex.: Soja"
                value={form.crop}
                onChange={(value) => handleChange("crop", value)}
              />
              <InputField
                label="Cidade"
                name="city"
                type="text"
                placeholder="Ex.: Londrina"
                value={form.city}
                onChange={(value) => handleChange("city", value)}
              />
              <InputField
                label="Estado *"
                name="state"
                type="text"
                placeholder="Ex.: PR"
                value={form.state}
                onChange={(value) => handleChange("state", value)}
              />
              <InputField
                label="Nome da propriedade"
                name="farmName"
                type="text"
                placeholder="Ex.: Fazenda Boa Safra"
                value={form.farmName}
                onChange={(value) => handleChange("farmName", value)}
              />
              <InputField
                label="Área em hectares"
                name="areaHectares"
                type="number"
                placeholder="Ex.: 120"
                value={form.areaHectares}
                onChange={(value) => handleChange("areaHectares", value)}
              />
              <InputField
                label="Tipo de solo"
                name="soilType"
                type="text"
                placeholder="Ex.: Argiloso"
                value={form.soilType}
                onChange={(value) => handleChange("soilType", value)}
              />
              <InputField
                label="Estágio da cultura"
                name="growthStage"
                type="text"
                placeholder="Ex.: V6, florescimento"
                value={form.growthStage}
                onChange={(value) => handleChange("growthStage", value)}
              />
            </div>

            {(errors.crop || errors.state || errors.areaHectares) && (
              <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                {errors.crop && <p>{errors.crop}</p>}
                {errors.state && <p>{errors.state}</p>}
                {errors.areaHectares && <p>{errors.areaHectares}</p>}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">
              Sintomas e manejo
            </h3>
            <div className="mt-6 grid gap-4">
              <label className="flex flex-col gap-2 text-sm text-slate-700">
                Sintomas observados *
                <textarea
                  name="symptoms"
                  value={form.symptoms}
                  onChange={(event) =>
                    handleChange("symptoms", event.target.value)
                  }
                  rows={6}
                  placeholder="Descreva manchas, amarelecimento, pragas, falhas de desenvolvimento, talhões afetados e quando o problema começou."
                  className="rounded-xl border border-leaf-100 bg-white px-4 py-3 text-slate-900 shadow-soft focus:border-leaf-400 focus:outline-none"
                />
              </label>
              {errors.symptoms && (
                <p className="text-sm text-red-600">{errors.symptoms}</p>
              )}

              <label className="flex flex-col gap-2 text-sm text-slate-700">
                Histórico de manejo
                <textarea
                  name="managementHistory"
                  value={form.managementHistory}
                  onChange={(event) =>
                    handleChange("managementHistory", event.target.value)
                  }
                  rows={5}
                  placeholder="Informe irrigação, adubação, defensivos aplicados, chuva recente e mudanças importantes no manejo."
                  className="rounded-xl border border-leaf-100 bg-white px-4 py-3 text-slate-900 shadow-soft focus:border-leaf-400 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">
              Fotos e documentos
            </h3>
            <div className="mt-6 space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">
                  Upload de fotos
                </span>
                <MobileImagePicker
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                  cameraAccept="image/*"
                  multiple
                  capture="environment"
                  onGalleryChange={handlePhotosChange}
                  onCameraChange={handlePhotosChange}
                  disabled={loading || loadingExistingCase || preparingPhotos}
                  galleryLabel="Escolher imagem"
                  cameraLabel="Tirar Foto"
                  galleryAriaLabel="Escolher uma ou mais imagens da galeria"
                  cameraAriaLabel="Tirar foto pelo smartphone"
                />
                <span className="text-xs text-slate-500">
                  Formatos aceitos: JPG, JPEG, PNG, WEBP, HEIC e HEIF. Limite de{" "}
                  {MAX_FILE_SIZE_LABEL} por arquivo. Fotos grandes do celular
                  são compactadas automaticamente.
                </span>
                {preparingPhotos && (
                  <span className="rounded-xl bg-leaf-50 p-3 text-leaf-800">
                    Preparando foto para envio pelo celular...
                  </span>
                )}
                {attachmentErrors.photos && (
                  <span className="rounded-xl bg-red-50 p-3 text-red-700">
                    {attachmentErrors.photos}
                  </span>
                )}
                {existingImages.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      Imagens já anexadas
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {existingImages.map((image) => (
                        <a
                          key={image.id}
                          href={image.image_url}
                          target="_blank"
                          className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50"
                        >
                          <Image
                            src={image.image_url}
                            alt="Imagem anterior do caso"
                            width={240}
                            height={112}
                            unoptimized
                            className="h-28 w-full object-cover"
                          />
                          <span className="block truncate px-3 py-2 text-xs text-slate-700">
                            Imagem anterior
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {photoPreviews.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {photoPreviews.map((preview) => (
                      <figure
                        key={preview.id}
                        className="overflow-hidden rounded-xl border border-leaf-100 bg-leaf-50"
                      >
                        <div className="relative">
                          <Image
                            src={preview.url}
                            alt={`Prévia de ${preview.name}`}
                            width={240}
                            height={112}
                            unoptimized
                            className="h-28 w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemovePhoto(preview.index)}
                            className="absolute right-2 top-2 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-red-700 shadow-soft"
                            aria-label={`Remover imagem ${preview.name}`}
                          >
                            Remover
                          </button>
                        </div>
                        <figcaption className="truncate px-3 py-2 text-xs text-slate-700">
                          {preview.name}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">
                  Upload de análise de solo em PDF ou imagem
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={handleSoilAnalysisChange}
                />
                <span className="text-xs text-slate-500">
                  Formatos aceitos: PDF, JPG, JPEG e PNG. Limite de{" "}
                  {MAX_FILE_SIZE_LABEL}.
                </span>
                {attachmentErrors.soilAnalysis && (
                  <span className="rounded-xl bg-red-50 p-3 text-red-700">
                    {attachmentErrors.soilAnalysis}
                  </span>
                )}
                {existingSoilAnalysisUrl && (
                  <a
                    href={existingSoilAnalysisUrl}
                    target="_blank"
                    className="rounded-xl bg-slate-50 p-3 text-leaf-700"
                  >
                    Ver análise de solo anterior
                  </a>
                )}
                {soilAnalysis && (
                  <span className="rounded-xl bg-leaf-50 p-3 text-slate-700">
                    Arquivo selecionado: {soilAnalysis.name}
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">
              Próxima etapa
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {isEditingExistingCase
                ? "Depois de salvar, a IA reprocessa o mesmo caso usando dados antigos e novos, e você volta para a revisão humana."
                : "Depois de salvar o caso, você será direcionado para a Consultoria IA com o identificador do caso na URL. A análise técnica fica para a próxima etapa."}
            </p>
          </div>

          {submitError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
              {submitError}
            </div>
          )}
          {successMessage && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
              {successMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || loadingExistingCase || preparingPhotos}
            className="w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {preparingPhotos
              ? "Preparando imagem..."
              : loading
                ? "Salvando e enviando..."
                : isEditingExistingCase
                  ? "Atualizar mesmo caso e reanalisar"
                  : "Salvar e enviar"}
          </button>
        </aside>
      </form>
    </section>
  );
}

export default function EnviarCasoPage() {
  return (
    <Suspense
      fallback={
        <section className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">
          Carregando envio de caso...
        </section>
      }
    >
      <EnviarCasoContent />
    </Suspense>
  );
}

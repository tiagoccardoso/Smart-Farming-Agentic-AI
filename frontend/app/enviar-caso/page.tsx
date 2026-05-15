"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import { submitAgronomicCase } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "10MB";
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

const initialForm = {
  crop: "",
  city: "",
  state: "",
  farmName: "",
  areaHectares: "",
  soilType: "",
  growthStage: "",
  symptoms: "",
  managementHistory: ""
};

type FormState = typeof initialForm;
type RequiredField = "crop" | "state" | "symptoms";

type FormErrors = Partial<Record<RequiredField, string>>;

type PhotoPreview = {
  file: File;
  url: string;
};

const requiredLabels: Record<RequiredField, string> = {
  crop: "Informe a cultura.",
  state: "Informe o estado.",
  symptoms: "Descreva os sintomas observados."
};

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateFile(file: File, allowedTypes: string[], allowedExtensions: string[], label: string) {
  const extension = getFileExtension(file.name);
  const hasAllowedType = allowedTypes.includes(file.type);
  const hasAllowedExtension = allowedExtensions.includes(extension);

  if (!hasAllowedType || !hasAllowedExtension) {
    return `${label}: o arquivo ${file.name} não está em um formato aceito.`;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${label}: o arquivo ${file.name} ultrapassa o limite de ${MAX_FILE_SIZE_LABEL}.`;
  }

  return null;
}

export default function EnviarCasoPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<File[]>([]);
  const [soilAnalysis, setSoilAnalysis] = useState<File | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreview[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [soilAnalysisError, setSoilAnalysisError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPhotoNames = useMemo(() => photos.map((file) => file.name).join(", "), [photos]);
  const fileErrors = useMemo(
    () => [...photoErrors, ...(soilAnalysisError ? [soilAnalysisError] : [])],
    [photoErrors, soilAnalysisError]
  );

  useEffect(() => {
    const previews = photos.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotoPreviews(previews);

    return () => previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [photos]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));

    if (key in requiredLabels && value.trim()) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const handlePhotosChange = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []);
    const nextErrors = nextFiles
      .map((file) => validateFile(file, ACCEPTED_IMAGE_TYPES, ACCEPTED_IMAGE_EXTENSIONS, "Fotos"))
      .filter((message): message is string => Boolean(message));

    setPhotoErrors(nextErrors);

    if (nextErrors.length > 0) {
      setPhotos([]);
      return;
    }

    setPhotos(nextFiles);
  };

  const handleSoilAnalysisChange = (file: File | null) => {
    if (!file) {
      setSoilAnalysis(null);
      setSoilAnalysisError(null);
      return;
    }

    const error = validateFile(file, ACCEPTED_SOIL_ANALYSIS_TYPES, ACCEPTED_SOIL_ANALYSIS_EXTENSIONS, "Análise de solo");

    if (error) {
      setSoilAnalysisError(error);
      setSoilAnalysis(null);
      return;
    }

    setSoilAnalysisError(null);
    setSoilAnalysis(file);
  };

  const validate = () => {
    const nextErrors: FormErrors = {};

    (Object.keys(requiredLabels) as RequiredField[]).forEach((field) => {
      if (!form[field].trim()) {
        nextErrors[field] = requiredLabels[field];
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 && fileErrors.length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    if (!validate()) {
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setSubmitError("Faça login com Supabase antes de enviar o caso agronômico.");
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
      const response = await submitAgronomicCase(formData, accessToken);
      router.push(`/consultoria-ia?caseId=${response.caseId}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Não foi possível enviar o caso. Confira os dados e tente novamente.");
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
            title="Enviar Caso"
            subtitle="Envie dados da cultura, sintomas, fotos e análise de solo para abrir um caso agronômico."
          />
          <p className="text-base leading-7 text-slate-700">
            O envio apenas registra o caso e organiza os anexos para a próxima etapa da consultoria. Nenhuma recomendação técnica é gerada nesta tela.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">Dados da propriedade e cultura</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Campos marcados com * são obrigatórios para criar o caso nas tabelas farms e agronomic_cases.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <InputField label="Cultura *" name="crop" type="text" placeholder="Ex.: Soja" value={form.crop} onChange={(value) => handleChange("crop", value)} />
              <InputField label="Cidade" name="city" type="text" placeholder="Ex.: Londrina" value={form.city} onChange={(value) => handleChange("city", value)} />
              <InputField label="Estado *" name="state" type="text" placeholder="Ex.: PR" value={form.state} onChange={(value) => handleChange("state", value)} />
              <InputField label="Nome da propriedade" name="farmName" type="text" placeholder="Ex.: Fazenda Boa Safra" value={form.farmName} onChange={(value) => handleChange("farmName", value)} />
              <InputField label="Área em hectares" name="areaHectares" type="number" placeholder="Ex.: 120" value={form.areaHectares} onChange={(value) => handleChange("areaHectares", value)} />
              <InputField label="Tipo de solo" name="soilType" type="text" placeholder="Ex.: Argiloso" value={form.soilType} onChange={(value) => handleChange("soilType", value)} />
              <InputField label="Estágio da cultura" name="growthStage" type="text" placeholder="Ex.: V6, florescimento" value={form.growthStage} onChange={(value) => handleChange("growthStage", value)} />
            </div>

            {(errors.crop || errors.state) && (
              <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                {errors.crop && <p>{errors.crop}</p>}
                {errors.state && <p>{errors.state}</p>}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">Sintomas e manejo</h3>
            <div className="mt-6 grid gap-4">
              <label className="flex flex-col gap-2 text-sm text-slate-700">
                Sintomas observados *
                <textarea
                  name="symptoms"
                  value={form.symptoms}
                  onChange={(event) => handleChange("symptoms", event.target.value)}
                  rows={6}
                  placeholder="Descreva manchas, amarelecimento, pragas, falhas de desenvolvimento, talhões afetados e quando o problema começou."
                  className="rounded-xl border border-leaf-100 bg-white px-4 py-3 text-slate-900 shadow-soft focus:border-leaf-400 focus:outline-none"
                />
              </label>
              {errors.symptoms && <p className="text-sm text-red-600">{errors.symptoms}</p>}

              <label className="flex flex-col gap-2 text-sm text-slate-700">
                Histórico de manejo
                <textarea
                  name="managementHistory"
                  value={form.managementHistory}
                  onChange={(event) => handleChange("managementHistory", event.target.value)}
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
            <h3 className="text-lg font-semibold text-slate-900">Fotos e documentos</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Os uploads serão salvos no bucket Supabase Storage <strong>{STORAGE_BUCKET}</strong> no padrão <strong>userId/caseId/nome-do-arquivo</strong>.
            </p>

            <div className="mt-6 space-y-5">
              <label className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-slate-600">
                Upload de fotos
                <span className="text-xs text-slate-500">Formatos aceitos: JPG, JPEG, PNG e WEBP. Tamanho máximo: {MAX_FILE_SIZE_LABEL} por arquivo.</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => handlePhotosChange(event.target.files)}
                />
                {selectedPhotoNames && <span className="rounded-xl bg-leaf-50 p-3 text-slate-700">Selecionado: {selectedPhotoNames}</span>}
                {photoPreviews.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photoPreviews.map((preview) => (
                      <figure key={`${preview.file.name}-${preview.file.lastModified}`} className="overflow-hidden rounded-2xl border border-leaf-100 bg-leaf-50">
                        <div
                          role="img"
                          aria-label={`Preview de ${preview.file.name}`}
                          className="h-28 w-full bg-cover bg-center"
                          style={{ backgroundImage: `url(${preview.url})` }}
                        />
                        <figcaption className="truncate px-3 py-2 text-xs text-slate-600">{preview.file.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </label>

              <label className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-slate-600">
                Upload de análise de solo em PDF ou imagem
                <span className="text-xs text-slate-500">Formatos aceitos: PDF, JPG, JPEG e PNG. Tamanho máximo: {MAX_FILE_SIZE_LABEL}.</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(event) => handleSoilAnalysisChange(event.target.files?.[0] ?? null)}
                />
                {soilAnalysis && <span className="rounded-xl bg-leaf-50 p-3 text-slate-700">Selecionado: {soilAnalysis.name}</span>}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">Próxima etapa</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Depois de salvar o caso, você será direcionado para a Consultoria IA com o identificador do caso na URL. A análise técnica fica para a próxima etapa.
            </p>
          </div>

          {fileErrors.length > 0 && (
            <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
              <p className="font-semibold">Revise os arquivos antes de enviar:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {fileErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {submitError && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{submitError}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Salvando caso..." : "Salvar caso e continuar"}
          </button>
        </aside>
      </form>
    </section>
  );
}

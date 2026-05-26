"use client";

import { ChangeEvent, FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { analyzeAgronomicCase, getAgronomicCase, submitAgronomicCase, updateAgronomicCase } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "10MB";
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = ["application/pdf", "image/jpeg", "image/png"];

type PhotoPreview = {
  name: string;
  url: string;
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
  managementHistory: ""
};

type FormState = typeof initialForm;
type RequiredField = "crop" | "state" | "symptoms";

type FormErrors = Partial<Record<RequiredField, string>>;
type AttachmentError = {
  photos?: string;
  soilAnalysis?: string;
};

const requiredLabels: Record<RequiredField, string> = {
  crop: "Informe a cultura.",
  state: "Informe o estado.",
  symptoms: "Descreva os sintomas observados."
};

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
  const [existingImages, setExistingImages] = useState<Array<{ id: string; image_url: string; created_at: string | null }>>([]);
  const [existingSoilAnalysisUrl, setExistingSoilAnalysisUrl] = useState<string | null>(null);

  const photoPreviews = useMemo<PhotoPreview[]>(
    () => photos.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [photos]
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
          areaHectares: caseData.farm?.area_hectares ? String(caseData.farm.area_hectares) : "",
          soilType: caseData.farm?.soil_type ?? "",
          growthStage: caseData.growth_stage ?? "",
          symptoms: caseData.symptoms ?? "",
          managementHistory: caseData.history ?? ""
        });
        setExistingImages(caseData.images ?? []);
        setExistingSoilAnalysisUrl(caseData.soil_analysis_url ?? null);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Não foi possível carregar o caso existente.");
      } finally {
        setLoadingExistingCase(false);
      }
    }

    loadExistingCase();
  }, [caseId]);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));

    if (key in requiredLabels && value.trim()) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };


  const validateFile = (file: File, allowedTypes: string[], label: string) => {
    if (!allowedTypes.includes(file.type)) {
      return `${label} "${file.name}" não está em um formato aceito.`;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${label} "${file.name}" excede o limite de ${MAX_FILE_SIZE_LABEL}.`;
    }

    return null;
  };

  const handlePhotosChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    const invalidFileMessage = selectedFiles
      .map((file) => validateFile(file, ACCEPTED_PHOTO_TYPES, "A imagem"))
      .find(Boolean);

    if (invalidFileMessage) {
      setPhotos([]);
      setAttachmentErrors((prev) => ({ ...prev, photos: invalidFileMessage }));
      event.target.value = "";
      return;
    }

    setPhotos(selectedFiles);
    setAttachmentErrors((prev) => ({ ...prev, photos: undefined }));
  };

  const handleSoilAnalysisChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      setSoilAnalysis(null);
      setAttachmentErrors((prev) => ({ ...prev, soilAnalysis: undefined }));
      return;
    }

    const invalidFileMessage = validateFile(selectedFile, ACCEPTED_SOIL_ANALYSIS_TYPES, "A análise de solo");

    if (invalidFileMessage) {
      setSoilAnalysis(null);
      setAttachmentErrors((prev) => ({ ...prev, soilAnalysis: invalidFileMessage }));
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

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);

    if (!validate()) {
      return;
    }

    if (attachmentErrors.photos || attachmentErrors.soilAnalysis) {
      setSubmitError("Revise os arquivos selecionados antes de enviar.");
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
      if (isEditingExistingCase) {
        await updateAgronomicCase(caseId, formData, accessToken);
        setSuccessMessage("Caso atualizado. A IA está reprocessando os dados e novas imagens...");
        await analyzeAgronomicCase(caseId, accessToken).catch(() => null);
        window.setTimeout(() => router.push(`/revisao-humana?caseId=${caseId}`), 650);
      } else {
        const response = await submitAgronomicCase(formData, accessToken);
        setSuccessMessage("Caso salvo com sucesso. Redirecionando para a Consultoria IA...");
        window.setTimeout(() => router.push(`/consultoria-ia?caseId=${response.caseId}`), 650);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Não foi possível enviar o caso.");
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
            title={isEditingExistingCase ? "Atualizar caso existente" : "Enviar Caso"}
            subtitle={isEditingExistingCase ? "Edite informações, complemente histórico e anexe novas imagens sem criar outro caso." : "Envie dados da cultura, sintomas, fotos e análise de solo para abrir um caso agronômico."}
          />
          <p className="text-base leading-7 text-[#414943]">
            {isEditingExistingCase ? "Você está atualizando o mesmo caseId. As imagens e conversas anteriores serão preservadas e a IA fará nova análise após salvar." : "O envio apenas registra o caso e organiza os anexos para a próxima etapa da consultoria. Nenhuma recomendação técnica é gerada nesta tela."}
          </p>
          <SafetyDisclaimer className="mt-5 bg-white/90" />
        </div>
      </div>

      <WorkflowStepper
        className="mt-8"
        steps={[
          { title: "Entrar", description: "Use sua conta para manter o caso salvo.", status: "done" },
          { title: "Enviar caso", description: "Preencha cultura, sintomas, histórico e anexos.", status: "current" },
          { title: "Consultoria IA", description: "Gere a pré-análise após o salvamento.", status: "next" },
          { title: "Revisão humana", description: "Pague a revisão se o risco for médio ou alto.", status: "next" },
          { title: "Meus relatórios", description: "Acompanhe o parecer final revisado.", status: "next" }
        ]}
      />

      {(loading || loadingExistingCase) && (
        <div className="mt-8">
          <LoadingCard title={loadingExistingCase ? "Carregando caso existente" : "Salvando o caso agronômico"} description={loadingExistingCase ? "Estamos preenchendo a tela com os dados já salvos, imagens anteriores e anexos." : "Estamos validando os dados, enviando anexos e preparando a reanálise com segurança. Não feche esta página."} rows={4} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-[#1d1c16]">Dados da propriedade e cultura</h3>
            <p className="mt-2 text-sm leading-6 text-[#414943]">
              Campos marcados com * são obrigatórios. Em modo de edição, o registro existente é atualizado sem gerar novo caseId.
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
            <h3 className="text-lg font-semibold text-[#1d1c16]">Sintomas e manejo</h3>
            <div className="mt-6 grid gap-4">
              <label className="flex flex-col gap-2 text-sm text-[#414943]">
                Sintomas observados *
                <textarea
                  name="symptoms"
                  value={form.symptoms}
                  onChange={(event) => handleChange("symptoms", event.target.value)}
                  rows={6}
                  placeholder="Descreva manchas, amarelecimento, pragas, falhas de desenvolvimento, talhões afetados e quando o problema começou."
                  className="rounded-xl border border-leaf-100 bg-white px-4 py-3 text-[#1d1c16] shadow-soft focus:border-leaf-400 focus:outline-none"
                />
              </label>
              {errors.symptoms && <p className="text-sm text-red-600">{errors.symptoms}</p>}

              <label className="flex flex-col gap-2 text-sm text-[#414943]">
                Histórico de manejo
                <textarea
                  name="managementHistory"
                  value={form.managementHistory}
                  onChange={(event) => handleChange("managementHistory", event.target.value)}
                  rows={5}
                  placeholder="Informe irrigação, adubação, defensivos aplicados, chuva recente e mudanças importantes no manejo."
                  className="rounded-xl border border-leaf-100 bg-white px-4 py-3 text-[#1d1c16] shadow-soft focus:border-leaf-400 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-[#1d1c16]">Fotos e documentos</h3>
            <p className="mt-2 text-sm leading-6 text-[#414943]">
              Os uploads estão preparados para o bucket Supabase Storage <strong>{STORAGE_BUCKET}</strong>.
            </p>

            <div className="mt-6 space-y-5">
              <label className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-[#414943]">
                <span className="font-semibold text-[#1d1c16]">Upload de fotos</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={handlePhotosChange}
                />
                <span className="text-xs text-[#717973]">Formatos aceitos: JPG, JPEG, PNG e WEBP. Limite de {MAX_FILE_SIZE_LABEL} por arquivo.</span>
                {attachmentErrors.photos && <span className="rounded-xl bg-red-50 p-3 text-red-700">{attachmentErrors.photos}</span>}
                {existingImages.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#717973]">Imagens já anexadas</p>
                    <div className="grid grid-cols-2 gap-3">
                      {existingImages.map((image) => (
                        <a key={image.id} href={image.image_url} target="_blank" className="overflow-hidden rounded-xl border border-[#e7e2d9] bg-[#f8f3ea]">
                          <Image src={image.image_url} alt="Imagem anterior do caso" width={240} height={112} unoptimized className="h-28 w-full object-cover" />
                          <span className="block truncate px-3 py-2 text-xs text-[#414943]">Imagem anterior</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {photoPreviews.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {photoPreviews.map((preview) => (
                      <figure key={`${preview.name}-${preview.url}`} className="overflow-hidden rounded-xl border border-leaf-100 bg-leaf-50">
                        <Image src={preview.url} alt={`Prévia de ${preview.name}`} width={240} height={112} unoptimized className="h-28 w-full object-cover" />
                        <figcaption className="truncate px-3 py-2 text-xs text-[#414943]">{preview.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </label>

              <label className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-5 text-sm text-[#414943]">
                <span className="font-semibold text-[#1d1c16]">Upload de análise de solo em PDF ou imagem</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={handleSoilAnalysisChange}
                />
                <span className="text-xs text-[#717973]">Formatos aceitos: PDF, JPG, JPEG e PNG. Limite de {MAX_FILE_SIZE_LABEL}.</span>
                {attachmentErrors.soilAnalysis && <span className="rounded-xl bg-red-50 p-3 text-red-700">{attachmentErrors.soilAnalysis}</span>}
                {existingSoilAnalysisUrl && <a href={existingSoilAnalysisUrl} target="_blank" className="rounded-xl bg-[#f8f3ea] p-3 text-leaf-700">Ver análise de solo anterior</a>}
                {soilAnalysis && <span className="rounded-xl bg-leaf-50 p-3 text-[#414943]">Arquivo selecionado: {soilAnalysis.name}</span>}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-[#1d1c16]">Próxima etapa</h3>
            <p className="mt-2 text-sm leading-6 text-[#414943]">
              {isEditingExistingCase ? "Depois de salvar, a IA reprocessa o mesmo caso usando dados antigos e novos, e você volta para a revisão humana." : "Depois de salvar o caso, você será direcionado para a Consultoria IA com o identificador do caso na URL. A análise técnica fica para a próxima etapa."}
            </p>
          </div>

          {submitError && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{submitError}</div>}
          {successMessage && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{successMessage}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Salvando caso..." : isEditingExistingCase ? "Atualizar mesmo caso e reanalisar" : "Salvar caso e continuar"}
          </button>
        </aside>
      </form>
    </section>
  );
}


export default function EnviarCasoPage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-6xl px-6 py-14 text-sm text-[#414943]">Carregando envio de caso...</section>}>
      <EnviarCasoContent />
    </Suspense>
  );
}

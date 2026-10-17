"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MobileImagePicker from "../../components/MobileImagePicker";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import SectionTitle from "../../components/SectionTitle";
import { createSubmissionKey, detectFileMime, optimizeImageFile, postFormWithProgress, RequestTransportError } from "../../lib/public-requests/client";
import {
  AFFECTED_PART_OPTIONS,
  DISEASE_TRIAGE_LIMITS,
  EMPTY_DISEASE_TRIAGE_FORM,
  validateDiseaseTriageForm,
  type DiseaseTriageField,
  type DiseaseTriageForm,
} from "../../lib/disease/triage";

type CropOption = { id: string; name: string; display_name_pt?: string | null };
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function localIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-bold text-slate-700">{label}{required ? <span className="text-red-600"> *</span> : null}</label>{hint ? <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p> : null}<div className="mt-2">{children}</div>{error ? <p className="mt-1 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}</div>;
}

const inputClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100";

export default function DiseasePage() {
  const router = useRouter();
  const [form, setForm] = useState<DiseaseTriageForm>(EMPTY_DISEASE_TRIAGE_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<DiseaseTriageField | "photos" | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const submissionKeyRef = useRef("");
  const formRef = useRef<HTMLFormElement | null>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  useEffect(() => {
    let active = true;
    fetch("/api/crops", { cache: "no-store" }).then((response) => response.json().catch(() => null)).then((payload) => { if (active) setCrops(Array.isArray(payload?.crops) ? payload.crops : []); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  // O rascunho é recuperado pelo cookie HttpOnly após o login/cadastro. Dados
  // da triagem não são transportados em query string.
  useEffect(() => {
    let active = true;
    const resumed = new URLSearchParams(window.location.search).get("triage") === "ready";
    if (resumed) setRecoveryMessage("Estamos recuperando as informações da sua planta...");
    fetch("/api/disease/triage/complete", { method: "POST", credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      const payload = (await response.json().catch(() => null)) as { redirectTo?: string; error?: string } | null;
      if (!active) return;
      if (response.ok && payload?.redirectTo) { router.replace(payload.redirectTo); return; }
      if (resumed && response.status !== 404 && response.status !== 401) setError(payload?.error || "Não foi possível concluir a criação do caso. Suas informações continuam salvas. Tente novamente.");
      if (resumed && response.status === 404) setError(payload?.error || "A triagem não está mais disponível. Preencha os dados novamente.");
    }).catch(() => { if (active && resumed) setError("Não foi possível recuperar a triagem agora. Tente atualizar a página."); }).finally(() => { if (active) setRecoveryMessage(""); });
    return () => { active = false; };
  }, [router]);

  function update(field: DiseaseTriageField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (fieldError === field) setFieldError(null);
    if (error) setError("");
  }

  async function addImages(selected: FileList | File[]) {
    const inputFiles = Array.from(selected).filter((file) => file.size > 0);
    if (!inputFiles.length) return;
    setPreparingImages(true); setError(""); setFieldError(null);
    try {
      const prepared = await Promise.all(inputFiles.map((file) => optimizeImageFile(file)));
      const nextFiles = [...files];
      for (const file of prepared) {
        const mime = await detectFileMime(file);
        if (!ACCEPTED_MIMES.has(mime)) throw new Error(`A imagem "${file.name}" não está em um formato aceito. Envie JPG, PNG ou WEBP.`);
        if (file.size > DISEASE_TRIAGE_LIMITS.maxImageBytes) throw new Error(`A imagem "${file.name}" excede o limite de 4 MB.`);
        if (!nextFiles.some((current) => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified)) nextFiles.push(file);
      }
      if (nextFiles.length > DISEASE_TRIAGE_LIMITS.maxImages) throw new Error(`Envie no máximo ${DISEASE_TRIAGE_LIMITS.maxImages} fotografias.`);
      if (nextFiles.reduce((total, file) => total + file.size, 0) > DISEASE_TRIAGE_LIMITS.maxTotalImageBytes) throw new Error("As fotografias somam mais de 4 MB após a preparação.");
      setFiles(nextFiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível preparar a fotografia."); setFieldError("photos");
    } finally { setPreparingImages(false); }
  }

  function removeImage(index: number) { setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index)); setPreviewIndex(null); }

  async function completeDraft() {
    const response = await fetch("/api/disease/triage/complete", { method: "POST", credentials: "same-origin", cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as { redirectTo?: string; error?: string } | null;
    if (response.ok && payload?.redirectTo) { router.replace(payload.redirectTo); return; }
    if (response.status === 401) { setRecoveryMessage("Suas informações estão prontas! Redirecionando para o login. As fotos e os dados informados serão preservados."); router.push(`/login?next=${encodeURIComponent("/doencas?triage=ready")}`); return; }
    throw new Error(payload?.error || "Não foi possível concluir a criação do caso. Suas informações continuam salvas. Tente novamente.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || preparingImages) return;
    setError(""); setFieldError(null);
    const validation = validateDiseaseTriageForm(form, files.length);
    if (!validation.ok) {
      setFieldError(validation.field); setError(validation.message);
      const target = formRef.current?.elements.namedItem(validation.field);
      if (target instanceof HTMLElement) target.focus();
      return;
    }
    setSubmitting(true); setProgress(0);
    try {
      const body = new FormData();
      Object.entries(validation.value).forEach(([key, value]) => body.append(key, value));
      submissionKeyRef.current ||= createSubmissionKey("disease-triage");
      body.append("submissionKey", submissionKeyRef.current);
      files.forEach((file) => body.append("photos", file, file.name));
      const result = await postFormWithProgress("/api/disease/triage/draft", body, { headers: { "Idempotency-Key": submissionKeyRef.current }, onProgress: setProgress, timeoutMs: 120000 });
      const payload = result.payload as { error?: string } | null;
      if (!result.ok) throw new Error(payload?.error || (result.status === 429 ? "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente." : "Não foi possível preservar a triagem agora."));
      await completeDraft();
    } catch (cause) {
      if (cause instanceof RequestTransportError && cause.kind === "timeout") setError("O envio demorou mais que o esperado. Tente novamente; sua tentativa não será duplicada.");
      else setError(cause instanceof Error ? cause.message : "Não foi possível concluir a triagem.");
    } finally { setSubmitting(false); setProgress(null); }
  }

  const value = (name: DiseaseTriageField) => form[name];

  return <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-14">
    <div className="rounded-3xl bg-hero-gradient p-5 shadow-soft sm:p-8 md:p-10">
      <p className="mb-3 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-bold uppercase tracking-wide text-leaf-700">Triagem fitossanitária</p>
      <SectionTitle title="Descreva o problema da sua planta" subtitle="Preencha a triagem antes de criar sua conta. No final, entraremos ou criaremos sua conta para salvar o caso com segurança." />
      <div className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-3"><div className="rounded-2xl bg-white/85 p-4">Você pode começar sem login</div><div className="rounded-2xl bg-white/85 p-4">Fotos preservadas durante a autenticação</div><div className="rounded-2xl bg-white/85 p-4">IA e parecer humano ficam para sua escolha</div></div>
    </div>

    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-6 space-y-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-soft sm:p-8">
      {recoveryMessage ? <div role="status" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">{recoveryMessage}</div> : null}
      <p className="text-xs leading-5 text-slate-500">Campos marcados com <span className="text-red-600">*</span> são obrigatórios. As informações complementares são opcionais.</p>

      <section aria-labelledby="triage-basic-title" className="space-y-4"><h2 id="triage-basic-title" className="text-lg font-black text-slate-950">O que está acontecendo?</h2><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da planta ou cultura" required error={fieldError === "crop" ? error : undefined}><input name="crop" value={value("crop")} onChange={(event) => update("crop", event.target.value)} list="crop-options" maxLength={DISEASE_TRIAGE_LIMITS.crop} className={inputClass} placeholder="Soja, tomate, roseira..." aria-invalid={fieldError === "crop"} /><datalist id="crop-options">{crops.map((crop) => <option key={crop.id} value={crop.display_name_pt || crop.name} />)}</datalist></Field>
        <Field label="Parte afetada" hint="Opcional."><select name="affectedPart" value={value("affectedPart")} onChange={(event) => update("affectedPart", event.target.value)} className={inputClass}><option value="">Selecione, se souber</option>{AFFECTED_PART_OPTIONS.map((part) => <option key={part} value={part}>{part}</option>)}</select></Field>
      </div><Field label="Sintomas observados" required error={fieldError === "symptoms" ? error : undefined} hint="Descreva manchas, coloração, necrose, deformações, insetos, queda de folhas ou outros sinais."><textarea name="symptoms" value={value("symptoms")} onChange={(event) => update("symptoms", event.target.value)} rows={5} maxLength={DISEASE_TRIAGE_LIMITS.symptoms} className={inputClass} placeholder="O que você observou e em quais partes da planta?" aria-invalid={fieldError === "symptoms"} /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Quando os sintomas começaram?" hint="Opcional."><input name="symptomStartDate" type="date" max={localIsoDate()} value={value("symptomStartDate")} onChange={(event) => update("symptomStartDate", event.target.value)} className={inputClass} /></Field><Field label="Como os sintomas evoluíram?" hint="Opcional."><input name="symptomEvolution" value={value("symptomEvolution")} onChange={(event) => update("symptomEvolution", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.symptomEvolution} className={inputClass} placeholder="Aumentaram, apareceram de repente..." /></Field><Field label="Quantidade de plantas afetadas" hint="Opcional."><input name="affectedProportion" value={value("affectedProportion")} onChange={(event) => update("affectedProportion", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.affectedProportion} className={inputClass} placeholder="Ex.: 10%, algumas folhas, todo o canteiro" /></Field><Field label="Estágio da cultura" hint="Opcional."><input name="growthStage" value={value("growthStage")} onChange={(event) => update("growthStage", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.growthStage} className={inputClass} placeholder="Vegetativo, florescimento..." /></Field></div></section>

      <section aria-labelledby="triage-context-title" className="space-y-4 border-t border-slate-100 pt-6"><h2 id="triage-context-title" className="text-lg font-black text-slate-950">Contexto que pode ajudar</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Condições ambientais" hint="Opcional."><textarea name="environmentalConditions" value={value("environmentalConditions")} onChange={(event) => update("environmentalConditions", event.target.value)} rows={3} maxLength={DISEASE_TRIAGE_LIMITS.environmentalConditions} className={inputClass} placeholder="Chuva, umidade, calor, geada, irrigação..." /></Field><Field label="Tratamentos ou produtos já utilizados" hint="Opcional."><textarea name="treatmentsUsed" value={value("treatmentsUsed")} onChange={(event) => update("treatmentsUsed", event.target.value)} rows={3} maxLength={DISEASE_TRIAGE_LIMITS.treatmentsUsed} className={inputClass} placeholder="Produto, adubação, pulverização ou nenhum." /></Field><Field label="Localização geral da planta" hint="Opcional."><input name="plantLocation" value={value("plantLocation")} onChange={(event) => update("plantLocation", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.plantLocation} className={inputClass} placeholder="Horta, estufa, talhão, vaso..." /></Field><Field label="Tipo de solo" hint="Opcional."><input name="soilType" value={value("soilType")} onChange={(event) => update("soilType", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.soilType} className={inputClass} placeholder="Argiloso, arenoso, drenagem..." /></Field><Field label="Cidade" hint="Opcional, quando relevante."><input name="city" value={value("city")} onChange={(event) => update("city", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.city} className={inputClass} placeholder="Município" /></Field><Field label="Estado" hint="Opcional."><input name="state" value={value("state")} onChange={(event) => update("state", event.target.value)} maxLength={DISEASE_TRIAGE_LIMITS.state} className={inputClass} placeholder="UF ou estado" /></Field></div><Field label="Informações adicionais" hint="Opcional."><textarea name="additionalInfo" value={value("additionalInfo")} onChange={(event) => update("additionalInfo", event.target.value)} rows={4} maxLength={DISEASE_TRIAGE_LIMITS.additionalInfo} className={inputClass} placeholder="Inclua algo que ainda não apareceu nas perguntas acima." /></Field><input type="hidden" name="history" value={value("history")} readOnly /></section>

      <section aria-labelledby="triage-photos-title" className="border-t border-slate-100 pt-6"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="triage-photos-title" className="text-lg font-black text-slate-950">Fotografias</h2><p className="mt-1 text-sm text-slate-600">Adicione até {DISEASE_TRIAGE_LIMITS.maxImages} fotos nítidas. Você poderá revisar e remover antes de continuar.</p></div><span className="text-xs font-semibold text-slate-500">{files.length}/{DISEASE_TRIAGE_LIMITS.maxImages}</span></div><div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addImages(event.dataTransfer.files); }} className={`mt-4 rounded-3xl border-2 border-dashed p-4 ${dragging ? "border-leaf-500 bg-leaf-50" : "border-slate-200 bg-slate-50"}`}>{previews.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{previews.map((preview, index) => <figure key={`${preview.file.name}-${preview.file.lastModified}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><button type="button" onClick={() => setPreviewIndex(index)} className="block w-full bg-black" aria-label={`Visualizar ${preview.file.name}`}><img src={preview.url} alt={`Prévia de ${preview.file.name}`} className="aspect-square w-full object-contain" /></button><div className="flex items-center justify-between gap-2 p-2"><span className="min-w-0 truncate text-xs text-slate-600">{preview.file.name}</span><button type="button" onClick={() => removeImage(index)} className="shrink-0 text-xs font-bold text-red-700">Remover</button></div></figure>)}</div> : <p className="py-8 text-center text-sm text-slate-600">Arraste fotos para cá ou use um dos botões abaixo.</p>}<MobileImagePicker accept={IMAGE_ACCEPT} cameraAccept="image/*" multiple capture="environment" galleryLabel="Escolher fotos" cameraLabel="Tirar foto" galleryAriaLabel="Escolher fotos da planta" cameraAriaLabel="Tirar foto da planta" disabled={submitting || preparingImages} onGalleryChange={(event: ChangeEvent<HTMLInputElement>) => void addImages(event.target.files ?? [])} onCameraChange={(event: ChangeEvent<HTMLInputElement>) => void addImages(event.target.files ?? [])} className="mt-3 justify-center" />{preparingImages ? <p className="mt-3 text-center text-sm font-semibold text-leaf-800" role="status">Preparando imagens para envio...</p> : null}</div>{fieldError === "photos" ? <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}</section>

      {fieldError !== "photos" && error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div> : null}<div className="rounded-2xl border border-leaf-100 bg-leaf-50 p-4 text-sm leading-6 text-leaf-950">Ao clicar em <strong>Iniciar triagem</strong>, validaremos os dados e preservaremos as fotos. Se você ainda não estiver autenticado, será encaminhado ao login ou cadastro antes da criação do caso.</div><button type="submit" disabled={submitting || preparingImages} className="w-full rounded-full bg-leaf-700 px-6 py-4 text-sm font-black uppercase tracking-wide text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-not-allowed disabled:bg-slate-300">{preparingImages ? "Preparando imagens..." : submitting ? `Preservando triagem${progress !== null ? ` · ${Math.round(progress * 100)}%` : "..."}` : "Iniciar triagem"}</button><p className="text-center text-sm text-slate-500">Já tem uma conta? <Link href="/login?next=%2Fdoencas%3Ftriage%3Dready" className="font-bold text-leaf-700 hover:underline">Entre para continuar</Link></p>
    </form><div className="mt-6"><SafetyDisclaimer /></div>
    {previewIndex !== null && previews[previewIndex] ? <div role="dialog" aria-modal="true" aria-label="Visualização da fotografia" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onClick={() => setPreviewIndex(null)}><div className="max-h-[90vh] max-w-4xl" onClick={(event) => event.stopPropagation()}><img src={previews[previewIndex].url} alt={`Visualização de ${previews[previewIndex].file.name}`} className="max-h-[80vh] rounded-2xl object-contain" /><button type="button" onClick={() => setPreviewIndex(null)} className="mx-auto mt-4 block rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-800">Fechar</button></div></div> : null}
  </section>;
}

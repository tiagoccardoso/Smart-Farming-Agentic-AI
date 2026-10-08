"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import MobileImagePicker from "../../MobileImagePicker";
import type { AgronomicCase } from "../../../lib/agronomic/case";
import { CASE_ATTACHMENT_LIMITS, PHOTO_INPUT_ACCEPT, SOIL_INPUT_ACCEPT, formatFileSize } from "../../../lib/agronomic/case-attachments";
import {
  changedFieldKeys,
  fieldsFromCase,
  hasUnsavedChanges,
  saveCaseChanges,
  type EditableCaseFields,
  type PendingUpload,
  type ReloadedCase,
  type SaveTransport,
} from "../../../lib/agronomic/case-save";
import { createClientId, prepareCasePhoto, prepareSoilAnalysis } from "../../../lib/agronomic/client-files";
import { RequestTransportError, postFormWithProgress } from "../../../lib/public-requests/client";
import SaveStatus, { type SaveState } from "./SaveStatus";
import { IconCheck, IconClose, IconDoc, IconRetry, IconTrash } from "./icons";

type FieldConfig = { key: keyof EditableCaseFields; label: string; placeholder?: string; inputMode?: "decimal" | "text"; required?: boolean; maxLength: number };

const FIELDS: FieldConfig[] = [
  { key: "crop", label: "Cultura", required: true, maxLength: 120, placeholder: "Ex.: Soja" },
  { key: "growthStage", label: "Estágio da cultura", maxLength: 160, placeholder: "Ex.: R3, florescimento" },
  { key: "farmName", label: "Propriedade", maxLength: 160 },
  { key: "city", label: "Cidade", maxLength: 120 },
  { key: "state", label: "Estado (UF)", required: true, maxLength: 60, placeholder: "Ex.: GO" },
  { key: "areaHectares", label: "Área (ha)", inputMode: "decimal", maxLength: 30 },
  { key: "soilType", label: "Tipo de solo", maxLength: 160 },
];

function Field({ label, error, required, children, htmlFor }: { label: string; error?: string; required?: boolean; children: ReactNode; htmlFor: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-sm font-bold text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-sm font-semibold text-red-700" id={`${htmlFor}-error`}>{error}</p> : null}
    </div>
  );
}

const inputClass = (error?: string) =>
  `w-full rounded-xl border bg-white px-3.5 py-2.5 text-base outline-none transition focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100 sm:text-[0.95rem] ${error ? "border-red-300" : "border-slate-200"}`;

export default function CaseEditor({
  caseData,
  getAccessToken,
  onSaved,
  onClose,
}: {
  caseData: AgronomicCase;
  getAccessToken: () => string | null;
  onSaved: (reloaded: ReloadedCase, info: { message: string }) => void;
  onClose: () => void;
}) {
  const [original, setOriginal] = useState<EditableCaseFields>(() => fieldsFromCase(caseData));
  const [fields, setFields] = useState<EditableCaseFields>(() => fieldsFromCase(caseData));
  const [existingImages, setExistingImages] = useState(caseData.images ?? []);
  const [soilUrl, setSoilUrl] = useState(caseData.soil_analysis_url);
  const [removeImageIds, setRemoveImageIds] = useState<string[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  const dirty = hasUnsavedChanges({ original, current: fields, uploads, removeImageIds });
  const contentDirty = changedFieldKeys(original, fields).length > 0;
  const displayState: SaveState = state === "saving" ? "saving" : state === "error" || state === "partial" ? state : dirty ? "dirty" : state;

  // Trava a rolagem do fundo (sem mudar a posição da página).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => () => Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  // Aviso ao sair da página com alterações pendentes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function updateField(key: keyof EditableCaseFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
    if (state === "saved") setState("idle");
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const pendingPhotos = uploads.filter((upload) => upload.kind === "photo" && upload.status !== "done").length;
    const room = CASE_ATTACHMENT_LIMITS.maxPhotosPerEdit - pendingPhotos;
    setPreparing(true);
    setMessage(null);
    const added: PendingUpload[] = [];
    const nextPreviews: Record<string, string> = {};
    const problems: string[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareCasePhoto(file);
        const id = createClientId("foto");
        added.push({ id, kind: "photo", file: prepared, status: "pending", progress: 0 });
        nextPreviews[id] = URL.createObjectURL(prepared);
      } catch (cause) {
        problems.push(cause instanceof Error ? cause.message : `Não foi possível usar "${file.name}".`);
      }
    }
    if (files.length > room) problems.push(`Adicione até ${CASE_ATTACHMENT_LIMITS.maxPhotosPerEdit} fotos por vez.`);
    setUploads((current) => [...current, ...added]);
    setPreviews((current) => ({ ...current, ...nextPreviews }));
    if (problems.length) setMessage(problems.join(" "));
    if (state === "saved") setState("idle");
    setPreparing(false);
  }

  async function chooseSoil(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreparing(true);
    try {
      const prepared = await prepareSoilAnalysis(file);
      setUploads((current) => [
        ...current.filter((upload) => upload.kind !== "soil_analysis" || upload.status === "done"),
        { id: createClientId("solo"), kind: "soil_analysis", file: prepared, status: "pending", progress: 0 },
      ]);
      if (state === "saved") setState("idle");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Não foi possível usar este arquivo.");
    } finally {
      setPreparing(false);
    }
  }

  function removePending(id: string) {
    setUploads((current) => current.filter((upload) => upload.id !== id));
    setPreviews((current) => {
      if (current[id]) URL.revokeObjectURL(current[id]);
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  }

  function toggleRemoveExisting(id: string) {
    setRemoveImageIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    if (state === "saved") setState("idle");
  }

  const transport: SaveTransport = useMemo(
    () => ({
      patchCase: async (body) => {
        const token = getAccessToken();
        if (!token) return { ok: false, status: 401, payload: { error: "Sua sessão expirou. Faça login novamente; suas alterações continuam na tela." } };
        const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseData.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        return { ok: response.ok && response.status !== 207, status: response.status, payload };
      },
      uploadAttachment: async (upload, onProgress) => {
        const token = getAccessToken();
        if (!token) return { ok: false, status: 401, payload: null };
        const body = new FormData();
        body.append("file", upload.file, upload.file.name);
        body.append("kind", upload.kind);
        body.append("clientUploadId", upload.id);
        try {
          return await postFormWithProgress(`/api/agronomic-cases/${encodeURIComponent(caseData.id)}/attachments`, body, {
            headers: { Authorization: `Bearer ${token}` },
            onProgress,
            timeoutMs: 120000,
          });
        } catch (cause) {
          return { ok: false, status: 0, payload: { error: cause instanceof RequestTransportError && cause.kind === "timeout" ? "O envio demorou demais. Tente novamente." : "Sem conexão. Tente novamente." } };
        }
      },
      reloadCase: async () => {
        const token = getAccessToken();
        const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseData.id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (!response.ok) return null;
        const payload = (await response.json().catch(() => null)) as { case?: ReloadedCase } | null;
        return payload?.case ?? null;
      },
    }),
    [caseData.id, getAccessToken],
  );

  async function save() {
    if (savingRef.current || !dirty || preparing) return;
    savingRef.current = true;
    setState("saving");
    setMessage(null);
    setFieldErrors({});
    try {
      const outcome = await saveCaseChanges({
        fields,
        contentDirty,
        removeImageIds,
        uploads,
        transport,
        onUploadsChange: setUploads,
      });

      if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);

      if (outcome.reloadedCase) {
        // O que o servidor confirmou vira a nova base; o que falhou continua pendente.
        const reloaded = outcome.reloadedCase;
        if (outcome.contentSaved) {
          setOriginal(fieldsFromCase(reloaded));
          if (outcome.status === "saved") setFields(fieldsFromCase(reloaded));
        }
        setExistingImages((reloaded.images ?? []) as AgronomicCase["images"]);
        setSoilUrl(reloaded.soil_analysis_url ?? null);
        setRemoveImageIds((current) => current.filter((id) => (reloaded.images ?? []).some((image) => image.id === id)));
        const doneIds = outcome.uploads.filter((upload) => upload.status === "done").map((upload) => upload.id);
        setUploads(outcome.uploads.filter((upload) => upload.status !== "done"));
        setPreviews((current) => {
          doneIds.forEach((id) => current[id] && URL.revokeObjectURL(current[id]));
          return Object.fromEntries(Object.entries(current).filter(([id]) => !doneIds.includes(id)));
        });
      } else {
        setUploads(outcome.uploads);
      }

      setMessage(outcome.message);
      setState(outcome.status === "saved" ? "saved" : outcome.status);
      if (outcome.status === "saved" && outcome.reloadedCase) {
        onSaved(outcome.reloadedCase, { message: outcome.message });
      } else if (outcome.status === "partial" && outcome.reloadedCase) {
        // Atualiza a tela de fundo com o que já foi salvo, sem fechar o editor.
        onSaved(outcome.reloadedCase, { message: "" });
      }
    } finally {
      savingRef.current = false;
    }
  }

  const pendingPhotos = uploads.filter((upload) => upload.kind === "photo");
  const pendingSoil = uploads.find((upload) => upload.kind === "soil_analysis");
  const busy = state === "saving";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        tabIndex={-1}
        className="flex h-[100dvh] w-full flex-col bg-white outline-none sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-[1.75rem] sm:shadow-soft"
        data-testid="case-editor"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <h2 id="editor-title" className="text-xl font-black text-slate-950">Editar caso</h2>
            <p className="text-sm text-slate-500">{caseData.crop} · as alterações só valem depois de salvas.</p>
          </div>
          <button type="button" onClick={requestClose} disabled={busy} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50" aria-label="Fechar edição">
            <IconClose className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <fieldset disabled={busy} className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((field) => (
                <Field key={field.key} label={field.label} required={field.required} error={fieldErrors[field.key]} htmlFor={`edit-${field.key}`}>
                  <input
                    id={`edit-${field.key}`}
                    value={fields[field.key]}
                    onChange={(event) => updateField(field.key, event.target.value)}
                    inputMode={field.inputMode}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                    className={inputClass(fieldErrors[field.key])}
                  />
                </Field>
              ))}
              <div className="sm:col-span-2">
                <Field label="Sintomas observados" required error={fieldErrors.symptoms} htmlFor="edit-symptoms">
                  <textarea id="edit-symptoms" value={fields.symptoms} onChange={(event) => updateField("symptoms", event.target.value)} rows={4} maxLength={6000} aria-invalid={Boolean(fieldErrors.symptoms)} className={inputClass(fieldErrors.symptoms)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Histórico de manejo" htmlFor="edit-history">
                  <textarea id="edit-history" value={fields.managementHistory} onChange={(event) => updateField("managementHistory", event.target.value)} rows={3} maxLength={6000} className={inputClass()} />
                </Field>
              </div>
            </section>

            <section aria-labelledby="edit-photos-title">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="edit-photos-title" className="font-bold text-slate-900">Fotos do caso</h3>
                  <p className="text-sm text-slate-500">As fotos atuais são mantidas. Marque só as que quiser remover.</p>
                </div>
              </div>
              {existingImages.length ? (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {existingImages.map((image) => {
                    const marked = removeImageIds.includes(image.id);
                    return (
                      <li key={image.id} className="relative overflow-hidden rounded-xl ring-1 ring-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element -- storage do Supabase */}
                        <img src={image.image_url} alt="Foto do caso" loading="lazy" className={`aspect-square w-full object-cover ${marked ? "opacity-30 grayscale" : ""}`} />
                        {marked ? <span className="absolute inset-x-1 top-1 rounded bg-red-600 px-1 py-0.5 text-center text-[0.65rem] font-bold text-white">Será removida</span> : null}
                        <button type="button" onClick={() => toggleRemoveExisting(image.id)} className={`absolute bottom-1 right-1 inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-bold shadow ${marked ? "bg-white text-slate-800" : "bg-white/95 text-red-700"}`} aria-pressed={marked} aria-label={marked ? "Manter esta foto" : "Remover esta foto"}>
                          {marked ? "Desfazer" : <><IconTrash className="h-3.5 w-3.5" /> Remover</>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Nenhuma foto anexada ainda.</p>
              )}

              {pendingPhotos.length ? (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Novas fotos">
                  {pendingPhotos.map((upload) => (
                    <li key={upload.id} className={`relative overflow-hidden rounded-xl ring-2 ${upload.status === "error" ? "ring-red-300" : "ring-leaf-300"}`}>
                      {previews[upload.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- pré-visualização local
                        <img src={previews[upload.id]} alt={`Nova foto ${upload.file.name}`} className="aspect-square w-full object-cover" />
                      ) : (
                        <div className="aspect-square bg-slate-100" />
                      )}
                      <span className="absolute left-1 top-1 rounded bg-leaf-700 px-1.5 py-0.5 text-[0.65rem] font-bold text-white">Nova</span>
                      {upload.status === "uploading" ? (
                        <div className="absolute inset-x-1 bottom-1 h-1.5 overflow-hidden rounded-full bg-white/70">
                          <div className="h-full bg-leaf-600 transition-all" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                        </div>
                      ) : null}
                      {upload.status === "error" ? <span className="absolute inset-x-1 bottom-1 rounded bg-red-600 px-1 py-0.5 text-center text-[0.65rem] font-bold text-white" title={upload.error ?? ""}>Falhou</span> : null}
                      {upload.status !== "uploading" ? (
                        <button type="button" onClick={() => removePending(upload.id)} className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/80 text-white" aria-label={`Descartar ${upload.file.name}`}>
                          <IconClose className="h-4 w-4" />
                        </button>
                      ) : null}
                      <span className="sr-only">{formatFileSize(upload.file.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <MobileImagePicker
                accept={PHOTO_INPUT_ACCEPT}
                cameraAccept="image/*"
                multiple
                disabled={busy || preparing}
                galleryLabel={preparing ? "Preparando..." : "Adicionar fotos"}
                cameraLabel="Tirar foto"
                galleryAriaLabel="Adicionar fotos da galeria"
                cameraAriaLabel="Tirar foto com a câmera"
                onGalleryChange={addPhotos}
                onCameraChange={addPhotos}
                className="mt-3"
              />
            </section>

            <section aria-labelledby="edit-soil-title" className="rounded-2xl border border-slate-200 p-4">
              <h3 id="edit-soil-title" className="font-bold text-slate-900">Análise de solo</h3>
              {soilUrl ? (
                <a href={soilUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-leaf-700 underline-offset-4 hover:underline">
                  <IconDoc className="h-4 w-4" /> Ver análise atual
                </a>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Nenhuma análise de solo enviada.</p>
              )}
              {pendingSoil ? (
                <div className={`mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${pendingSoil.status === "error" ? "bg-red-50 text-red-800" : "bg-leaf-50 text-slate-700"}`}>
                  <span className="min-w-0 truncate">
                    {soilUrl ? "Substituir por" : "Enviar"}: <strong>{pendingSoil.file.name}</strong> ({formatFileSize(pendingSoil.file.size)})
                    {pendingSoil.status === "uploading" ? ` · ${Math.round(pendingSoil.progress * 100)}%` : ""}
                    {pendingSoil.status === "error" ? ` · ${pendingSoil.error}` : ""}
                  </span>
                  {pendingSoil.status !== "uploading" ? (
                    <button type="button" onClick={() => removePending(pendingSoil.id)} className="shrink-0 font-bold text-red-700">Descartar</button>
                  ) : null}
                </div>
              ) : null}
              <MobileImagePicker
                accept={SOIL_INPUT_ACCEPT}
                cameraAccept="image/*"
                disabled={busy || preparing}
                galleryLabel={soilUrl ? "Substituir arquivo" : "Selecionar PDF ou imagem"}
                cameraLabel="Fotografar laudo"
                galleryAriaLabel="Selecionar análise de solo"
                cameraAriaLabel="Fotografar análise de solo"
                onGalleryChange={chooseSoil}
                onCameraChange={chooseSoil}
                className="mt-3"
              />
              {soilUrl ? <p className="mt-2 text-xs text-slate-500">O arquivo anterior fica guardado no histórico do caso.</p> : null}
            </section>
          </fieldset>
        </div>

        <footer className="border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:rounded-b-[1.75rem] sm:px-6">
          {confirmDiscard ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-label="Descartar alterações">
              <p className="text-sm font-semibold text-slate-800">Descartar as alterações não salvas?</p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-11 rounded-full bg-leaf-600 px-4 text-sm font-bold text-white">Continuar editando</button>
                <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-red-200 px-4 text-sm font-bold text-red-700">Descartar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <SaveStatus state={displayState} message={message} />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button type="button" onClick={requestClose} disabled={busy} className="min-h-11 rounded-full border border-slate-200 px-5 text-sm font-bold text-slate-700 disabled:opacity-50">
                  {dirty ? "Cancelar" : "Fechar"}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy || preparing || !dirty}
                  className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-leaf-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-leaf-700 disabled:bg-slate-300 sm:px-5"
                  data-testid="save-case"
                >
                  {state === "error" || state === "partial" ? <IconRetry className="h-4 w-4" /> : busy ? null : <IconCheck className="h-4 w-4" />}
                  {busy ? "Salvando..." : state === "error" || state === "partial" ? "Tentar novamente" : <><span className="sm:hidden">Salvar</span><span className="hidden sm:inline">Salvar alterações</span></>}
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

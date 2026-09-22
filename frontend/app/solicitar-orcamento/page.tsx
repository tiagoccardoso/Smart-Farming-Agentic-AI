"use client";

/**
 * Presencial & Projetos Especiais — solicitação de orçamento.
 *
 * Categoria sob consulta: nenhuma cobrança automática antes da definição do
 * orçamento. Se o usuário estiver autenticado, os dados já conhecidos e as
 * propriedades cadastradas são preenchidos automaticamente.
 *
 * Mesmo padrão do formulário de Contato (components/public-request): assistente
 * de escrita com IA, fotos e mensagem de voz opcionais e envio sem duplicidade.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import AiWritingAssistant from "../../components/public-request/AiWritingAssistant";
import type { AudioValue } from "../../components/public-request/AudioAttachment";
import FormAlert from "../../components/public-request/FormAlert";
import FormField from "../../components/public-request/FormField";
import FormSection from "../../components/public-request/FormSection";
import HoneypotField from "../../components/public-request/HoneypotField";
import { revokeImageItems, type ImageItem } from "../../components/public-request/ImageAttachments";
import PageHeader from "../../components/public-request/PageHeader";
import RequestAttachments, { appendAttachments, getAttachmentBlocker } from "../../components/public-request/RequestAttachments";
import SubmitButton from "../../components/public-request/SubmitButton";
import { formCardClass, inputClass } from "../../components/public-request/styles";
import { usePublicRequestSubmit, useUnsavedChangesWarning } from "../../components/public-request/usePublicRequestSubmit";
import { QUOTE_SERVICE_LABELS, QUOTE_SERVICE_TYPES } from "../../lib/service-quotes";

type Property = { id: string; name: string; location_gps: string | null };

const SERVICE_OPTIONS = QUOTE_SERVICE_TYPES.map((value) => ({ value, label: QUOTE_SERVICE_LABELS[value] }));

const initialForm = {
  name: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  serviceType: "visita_tecnica",
  propertyId: "",
  description: "",
  notes: ""
};

export default function SolicitarOrcamentoPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [website, setWebsite] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [audio, setAudio] = useState<AudioValue | null>(null);
  const [recording, setRecording] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const { submitting, progress, error, success, setError, setSuccess, submit } = usePublicRequestSubmit("quote");

  useEffect(() => {
    let active = true;

    fetch("/api/service-quotes", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!active || !payload) return;
        setAuthenticated(Boolean(payload.authenticated));
        setProperties(Array.isArray(payload.properties) ? payload.properties : []);
        if (payload.prefill) {
          setForm((current) => ({
            ...current,
            name: payload.prefill.name || current.name,
            email: payload.prefill.email || current.email,
            phone: payload.prefill.phone || current.phone
          }));
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (error || success) alertRef.current?.focus();
  }, [error, success]);

  const dirty = !success && (form.description.trim().length > 0 || images.length > 0 || audio !== null);
  useUnsavedChangesWarning(dirty && !submitting);

  function update(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (success) setSuccess("");
  }

  const buildAiPayload = useCallback(
    () => ({
      source: "quote",
      website,
      serviceType: form.serviceType,
      city: form.city,
      state: form.state,
      notes: form.notes,
      imageCount: images.filter((item) => item.status === "ready").length,
      hasAudio: audio !== null
    }),
    [audio, form.city, form.notes, form.serviceType, form.state, images, website]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSuccess("");

    if (!audio && form.description.trim().length < 10) {
      setError("Descreva a necessidade com pelo menos 10 caracteres ou grave um áudio explicando.");
      return;
    }

    const blocker = getAttachmentBlocker(images, audio, recording);
    if (blocker) {
      setError(blocker);
      return;
    }

    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    formData.append("website", website);
    const attachmentCount = appendAttachments(formData, images, audio);

    const payload = await submit("/api/service-quotes", formData, {
      trackProgress: attachmentCount > 0,
      fallbackSuccess: "Solicitação registrada.",
      fallbackError: "Não foi possível registrar a solicitação."
    });

    if (payload) {
      setForm((current) => ({ ...current, description: "", notes: "" }));
      revokeImageItems(images);
      setImages([]);
      if (audio?.url) URL.revokeObjectURL(audio.url);
      setAudio(null);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <PageHeader
        backLink={{ href: "/planos", label: "Voltar para os planos" }}
        eyebrow="Presencial & Projetos Especiais"
        title="Solicitar orçamento"
        subtitle="Conte o que sua propriedade precisa. Se preferir, anexe fotos ou grave um áudio. O escopo, o prazo e o valor são definidos junto com você, sem cobrança automática."
      />

      <form onSubmit={handleSubmit} className={`relative ${formCardClass}`}>
        <HoneypotField value={website} onChange={setWebsite} />
        <fieldset disabled={submitting} className="grid min-w-0 gap-6">
          <FormSection title="Seus dados">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Produtor ou cliente" required>
                <input required minLength={3} autoComplete="name" value={form.name} onChange={(event) => update("name", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Telefone" required>
                <input required minLength={8} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="E-mail">
                <input type="email" autoComplete="email" value={form.email} onChange={(event) => update("email", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Tipo de serviço">
                <select value={form.serviceType} onChange={(event) => update("serviceType", event.target.value)} className={inputClass}>
                  {SERVICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Município" required>
                <input required minLength={2} autoComplete="address-level2" value={form.city} onChange={(event) => update("city", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="UF" required>
                <input
                  required
                  minLength={2}
                  maxLength={2}
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(event) => update("state", event.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FormField>
            </div>

            {authenticated && properties.length > 0 && (
              <FormField label="Propriedade (opcional)">
                <select value={form.propertyId} onChange={(event) => update("propertyId", event.target.value)} className={inputClass}>
                  <option value="">Não vincular a uma propriedade</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </FormSection>

          <FormSection title="Sua necessidade">
            <div className="min-w-0">
              <FormField label="Descrição da necessidade" required={!audio} hint={audio ? "Opcional: você anexou um áudio explicando a necessidade." : undefined}>
                <textarea
                  required={!audio}
                  rows={6}
                  maxLength={4000}
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                  className={inputClass}
                  placeholder="Descreva a propriedade, a cultura, o serviço desejado e o que espera do atendimento."
                />
              </FormField>
              <AiWritingAssistant message={form.description} onApply={(text) => update("description", text)} buildPayload={buildAiPayload} disabled={submitting} />
            </div>

            <FormField label="Observações (opcional)">
              <textarea rows={3} maxLength={4000} value={form.notes} onChange={(event) => update("notes", event.target.value)} className={inputClass} />
            </FormField>
          </FormSection>

          <RequestAttachments images={images} setImages={setImages} audio={audio} setAudio={setAudio} onRecordingChange={setRecording} disabled={submitting} />

          <FormAlert tone="info">Nenhuma cobrança é realizada antes da definição e da sua aprovação do orçamento.</FormAlert>

          {error ? (
            <FormAlert ref={alertRef} tone="error">
              {error}
            </FormAlert>
          ) : null}
          {success ? (
            <FormAlert ref={alertRef} tone="success" title="Solicitação enviada com sucesso!">
              {success}
            </FormAlert>
          ) : null}

          <SubmitButton label="Solicitar orçamento" submitting={submitting} progress={progress} />
        </fieldset>
      </form>
    </section>
  );
}

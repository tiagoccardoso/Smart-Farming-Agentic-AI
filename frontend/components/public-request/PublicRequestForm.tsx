"use client";

/**
 * Formulario unico de Contato (/contact) e Solicitacao de Orcamento
 * (/solicitar-orcamento).
 *
 * Mesmos campos, mesma ordem, mesmas validacoes (lib/public-requests/form.ts,
 * repetidas no servidor), mesmos recursos (IA, fotos, audio), mesmas mensagens
 * e mesmo fluxo de envio. A unica diferenca funcional e `origin`, que define a
 * rota de envio e, no servidor, a origem gravada em `source` (usada para o selo
 * "Solicitacao de orcamento" na area da especialista).
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { normalizeContactRequestType, CONTACT_REQUEST_TYPE_OPTIONS, isContactVisitType } from "../../lib/public-requests/contact";
import {
  BRAZILIAN_STATES,
  EMPTY_PUBLIC_REQUEST_FORM,
  PUBLIC_REQUEST_ERROR_MESSAGE,
  PUBLIC_REQUEST_LIMITS,
  PUBLIC_REQUEST_SUCCESS_MESSAGE,
  isPublicRequestFormField,
  localIsoDate,
  validatePublicRequestForm,
  type PublicRequestFormField,
  type PublicRequestFormInput,
  type PublicRequestOrigin
} from "../../lib/public-requests/form";
import AiWritingAssistant from "./AiWritingAssistant";
import type { AudioValue } from "./AudioAttachment";
import FormAlert from "./FormAlert";
import FormField from "./FormField";
import FormSection from "./FormSection";
import HoneypotField from "./HoneypotField";
import { revokeImageItems, type ImageItem } from "./ImageAttachments";
import PageHeader from "./PageHeader";
import RequestAttachments, { appendAttachments, getAttachmentBlocker } from "./RequestAttachments";
import SubmitButton from "./SubmitButton";
import { formCardClass, inputClass } from "./styles";
import { usePublicRequestSubmit, useUnsavedChangesWarning } from "./usePublicRequestSubmit";

type Property = { id: string; name: string };

const ENDPOINTS: Record<PublicRequestOrigin, string> = {
  contact: "/api/contact",
  quote: "/api/service-quotes"
};

/** Apenas o cabecalho da pagina muda conforme o ponto de entrada. */
const HEADERS: Record<PublicRequestOrigin, { eyebrow: string; title: string; subtitle: string; backLink?: { href: string; label: string } }> = {
  contact: {
    eyebrow: "Contato oficial Plantasã",
    title: "Fale com a especialista",
    subtitle:
      "Conte o que você precisa: consultoria, visita técnica, revisão de caso agrícola ou transição para produção orgânica. Se preferir, anexe fotos ou grave um áudio."
  },
  quote: {
    eyebrow: "Presencial & Projetos Especiais",
    title: "Solicitar orçamento",
    subtitle:
      "Conte o que sua propriedade precisa. Se preferir, anexe fotos ou grave um áudio. O escopo, o prazo e o valor são definidos junto com você, sem cobrança automática.",
    backLink: { href: "/planos", label: "Voltar para os planos" }
  }
};

const PERIOD_SUGGESTIONS = ["Manhã", "Tarde", "Qualquer horário"];

type FieldError = { field: PublicRequestFormField; message: string };

export default function PublicRequestForm({ origin }: { origin: PublicRequestOrigin }) {
  const [form, setForm] = useState<PublicRequestFormInput>(EMPTY_PUBLIC_REQUEST_FORM);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [minDate, setMinDate] = useState("");
  const [website, setWebsite] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [audio, setAudio] = useState<AudioValue | null>(null);
  const [recording, setRecording] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const { submitting, progress, error, success, setError, setSuccess, submit } = usePublicRequestSubmit(origin);
  const header = HEADERS[origin];
  const periodListId = `${origin}-period-suggestions`;

  // Data minima e tipo vindo de links (?requestType=...) sao lidos apenas no
  // navegador, para nao divergir da renderizacao do servidor.
  useEffect(() => {
    setMinDate(localIsoDate());
    const requestType = normalizeContactRequestType(new URLSearchParams(window.location.search).get("requestType"));
    if (requestType) setForm((current) => ({ ...current, requestType }));
  }, []);

  // Usuario autenticado: pre-preenche nome, e-mail e telefone e lista as
  // propriedades cadastradas. Nunca sobrescreve o que ja foi digitado.
  useEffect(() => {
    let active = true;
    fetch("/api/service-quotes", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!active || !payload) return;
        setProperties(Array.isArray(payload.properties) ? payload.properties : []);
        if (payload.prefill) {
          setForm((current) => ({
            ...current,
            name: current.name || payload.prefill.name || "",
            email: current.email || payload.prefill.email || "",
            phone: current.phone || payload.prefill.phone || ""
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

  // Leva o foco ao campo com erro (depois que o formulario volta a ficar habilitado).
  useEffect(() => {
    if (!fieldError || submitting) return;
    const element = formRef.current?.elements.namedItem(fieldError.field);
    if (element instanceof HTMLElement) element.focus();
  }, [fieldError, submitting]);

  const isVisit = isContactVisitType(form.requestType);
  const dirty = !success && (form.message.trim().length > 0 || images.length > 0 || audio !== null);
  useUnsavedChangesWarning(dirty && !submitting);

  function update(field: PublicRequestFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (fieldError?.field === field) setFieldError(null);
    if (success) setSuccess("");
  }

  function errorFor(field: PublicRequestFormField) {
    return fieldError?.field === field ? fieldError.message : undefined;
  }

  function handleAudioChange(value: AudioValue | null) {
    setAudio(value);
    if (value && fieldError?.field === "message") setFieldError(null);
  }

  const buildAiPayload = useCallback(
    () => ({
      source: origin,
      website,
      requestType: form.requestType,
      city: form.city,
      state: form.state,
      preferredDate: form.preferredDate,
      preferredTime: form.preferredTime,
      imageCount: images.filter((item) => item.status === "ready").length,
      hasAudio: audio !== null
    }),
    [audio, form.city, form.preferredDate, form.preferredTime, form.requestType, form.state, images, origin, website]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSuccess("");
    setError("");

    const validation = validatePublicRequestForm(form, { hasAudio: audio !== null, minDate });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      return;
    }
    setFieldError(null);

    const blocker = getAttachmentBlocker(images, audio, recording);
    if (blocker) {
      setError(blocker);
      return;
    }

    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    formData.append("website", website);
    const attachmentCount = appendAttachments(formData, images, audio);

    const payload = await submit(ENDPOINTS[origin], formData, {
      trackProgress: attachmentCount > 0,
      fallbackSuccess: PUBLIC_REQUEST_SUCCESS_MESSAGE,
      fallbackError: PUBLIC_REQUEST_ERROR_MESSAGE,
      onRejected: (body) => {
        if (body && isPublicRequestFormField(body.field) && typeof body.error === "string" && body.error) {
          setFieldError({ field: body.field, message: body.error });
          return true;
        }
        return false;
      }
    });

    if (payload) {
      // Mantem os dados de identificacao para um eventual novo envio.
      setForm((current) => ({
        ...EMPTY_PUBLIC_REQUEST_FORM,
        name: current.name,
        phone: current.phone,
        email: current.email,
        city: current.city,
        state: current.state,
        requestType: current.requestType
      }));
      revokeImageItems(images);
      setImages([]);
      if (audio?.url) URL.revokeObjectURL(audio.url);
      setAudio(null);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <PageHeader eyebrow={header.eyebrow} title={header.title} subtitle={header.subtitle} backLink={header.backLink} />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className={`relative ${formCardClass}`}>
        <HoneypotField value={website} onChange={setWebsite} />
        <fieldset disabled={submitting} className="grid min-w-0 gap-6">
          <p className="text-xs leading-5 text-slate-500">
            Campos marcados com <span className="text-red-700" aria-hidden="true">*</span>
            <span className="sr-only">asterisco</span> são obrigatórios.
          </p>

          <FormSection title="Seus dados">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Nome" required error={errorFor("name")} className="md:col-span-2">
                <input
                  name="name"
                  required
                  autoComplete="name"
                  maxLength={PUBLIC_REQUEST_LIMITS.name}
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Telefone / WhatsApp" required error={errorFor("phone")} hint="Com DDD. É por aqui que a especialista retorna.">
                <input
                  name="phone"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={PUBLIC_REQUEST_LIMITS.phone}
                  placeholder="(11) 91234-5678"
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  className={inputClass}
                />
              </FormField>
              <FormField label="E-mail" error={errorFor("email")} hint="Opcional.">
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={PUBLIC_REQUEST_LIMITS.email}
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  className={inputClass}
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Atendimento">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Tipo de atendimento" required error={errorFor("requestType")} className="md:col-span-2">
                <select name="requestType" required value={form.requestType} onChange={(event) => update("requestType", event.target.value)} className={inputClass}>
                  <option value="" disabled>
                    Selecione o tipo de atendimento
                  </option>
                  {CONTACT_REQUEST_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Cidade" required error={errorFor("city")}>
                <input
                  name="city"
                  required
                  autoComplete="address-level2"
                  maxLength={PUBLIC_REQUEST_LIMITS.city}
                  value={form.city}
                  onChange={(event) => update("city", event.target.value)}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Estado (UF)" required error={errorFor("state")}>
                <select name="state" required autoComplete="address-level1" value={form.state} onChange={(event) => update("state", event.target.value)} className={inputClass}>
                  <option value="">Selecione</option>
                  {BRAZILIAN_STATES.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </FormField>

              {properties.length > 0 ? (
                <FormField label="Propriedade" error={errorFor("propertyId")} hint="Opcional. Vincula a solicitação a uma propriedade cadastrada." className="md:col-span-2">
                  <select name="propertyId" value={form.propertyId} onChange={(event) => update("propertyId", event.target.value)} className={inputClass}>
                    <option value="">Não vincular a uma propriedade</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}

              <FormField label="Data desejada" required={isVisit} error={errorFor("preferredDate")} hint={isVisit ? undefined : "Opcional. Útil para visitas."}>
                <input
                  name="preferredDate"
                  required={isVisit}
                  type="date"
                  min={minDate || undefined}
                  value={form.preferredDate}
                  onChange={(event) => update("preferredDate", event.target.value)}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Horário ou período" required={isVisit} error={errorFor("preferredTime")} hint={isVisit ? undefined : "Opcional. Útil para visitas."}>
                <input
                  name="preferredTime"
                  required={isVisit}
                  list={periodListId}
                  maxLength={PUBLIC_REQUEST_LIMITS.preferredTime}
                  placeholder="Ex.: manhã, tarde ou 9h"
                  value={form.preferredTime}
                  onChange={(event) => update("preferredTime", event.target.value)}
                  className={inputClass}
                />
              </FormField>
              <datalist id={periodListId}>
                {PERIOD_SUGGESTIONS.map((period) => (
                  <option key={period} value={period} />
                ))}
              </datalist>
            </div>
          </FormSection>

          <FormSection title="Sua necessidade">
            <div className="min-w-0">
              <FormField
                label="Descreva sua necessidade"
                required={!audio}
                error={errorFor("message")}
                hint={
                  audio
                    ? "Opcional: você anexou um áudio explicando a necessidade."
                    : `Mínimo de ${PUBLIC_REQUEST_LIMITS.minMessage} caracteres. Se preferir, grave um áudio na seção abaixo.`
                }
              >
                <textarea
                  name="message"
                  required={!audio}
                  rows={7}
                  maxLength={PUBLIC_REQUEST_LIMITS.message}
                  value={form.message}
                  onChange={(event) => update("message", event.target.value)}
                  className={`${inputClass} min-h-40 resize-y`}
                  placeholder="Descreva a cultura, a propriedade, o problema observado ou o serviço que você procura."
                />
              </FormField>
              <AiWritingAssistant message={form.message} onApply={(text) => update("message", text)} buildPayload={buildAiPayload} disabled={submitting} />
            </div>
          </FormSection>

          <RequestAttachments images={images} setImages={setImages} audio={audio} setAudio={handleAudioChange} onRecordingChange={setRecording} disabled={submitting} />

          <FormAlert tone="info">O envio é gratuito. Quando o atendimento tiver custo, o orçamento é apresentado antes, para a sua aprovação.</FormAlert>

          {error ? (
            <FormAlert ref={alertRef} tone="error">
              {error}
            </FormAlert>
          ) : null}
          {fieldError && !error ? (
            <p className="sr-only" role="alert">
              {fieldError.message}
            </p>
          ) : null}
          {success ? (
            <FormAlert ref={alertRef} tone="success" title="Solicitação enviada com sucesso!">
              {success}
            </FormAlert>
          ) : null}

          <SubmitButton label="Enviar solicitação" submitting={submitting} progress={progress} />
        </fieldset>
      </form>
    </section>
  );
}

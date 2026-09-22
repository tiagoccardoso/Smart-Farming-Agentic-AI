"use client";

/**
 * Contato oficial (/contact).
 *
 * Mesmo padrao visual e de comportamento da Solicitacao de Orcamento
 * (components/public-request): assistente de escrita com IA, fotos e mensagem
 * de voz opcionais, envio com progresso e protecao contra envio duplicado.
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
import { CONTACT_REQUEST_TYPE_OPTIONS, isContactRequestType, isContactVisitType } from "../../lib/public-requests/contact";

const initialForm = { name: "", email: "", phone: "", city: "", state: "", preferredDate: "", preferredTime: "", requestType: "consultoria_geral", message: "" };

export default function ContactPage() {
  const [form, setForm] = useState(initialForm);
  const [website, setWebsite] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [audio, setAudio] = useState<AudioValue | null>(null);
  const [recording, setRecording] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const { submitting, progress, error, success, setError, setSuccess, submit } = usePublicRequestSubmit("contact");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestType = new URLSearchParams(window.location.search).get("requestType");
    if (isContactRequestType(requestType)) setForm((prev) => ({ ...prev, requestType }));
  }, []);

  // Usuario autenticado: pre-preenche nome, e-mail e telefone (mesma fonte do orcamento).
  useEffect(() => {
    let active = true;
    fetch("/api/service-quotes", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!active || !payload?.prefill) return;
        setForm((current) => ({
          ...current,
          name: current.name || payload.prefill.name || "",
          email: current.email || payload.prefill.email || "",
          phone: current.phone || payload.prefill.phone || ""
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (error || success) alertRef.current?.focus();
  }, [error, success]);

  const isVisit = isContactVisitType(form.requestType);
  const dirty = !success && (form.message.trim().length > 0 || images.length > 0 || audio !== null);
  useUnsavedChangesWarning(dirty && !submitting);

  function update(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (success) setSuccess("");
  }

  const buildAiPayload = useCallback(
    () => ({
      source: "contact",
      website,
      requestType: form.requestType,
      city: form.city,
      state: form.state,
      preferredDate: form.preferredDate,
      preferredTime: form.preferredTime,
      imageCount: images.filter((item) => item.status === "ready").length,
      hasAudio: audio !== null
    }),
    [audio, form.city, form.preferredDate, form.preferredTime, form.requestType, form.state, images, website]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSuccess("");

    if (isVisit && (!form.phone || !form.city || !form.state || !form.preferredDate || !form.preferredTime)) {
      setError("Preencha telefone, cidade, estado, dia e horário para solicitações de visita.");
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

    const payload = await submit("/api/contact", formData, {
      trackProgress: attachmentCount > 0,
      fallbackSuccess: "Recebemos sua solicitação. A especialista entrará em contato para confirmar as informações.",
      fallbackError: "Não foi possível enviar sua solicitação. Tente novamente."
    });

    if (payload) {
      setForm((current) => ({ ...initialForm, name: current.name, email: current.email, phone: current.phone }));
      revokeImageItems(images);
      setImages([]);
      if (audio?.url) URL.revokeObjectURL(audio.url);
      setAudio(null);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <PageHeader
        eyebrow="Contato oficial Plantasã"
        title="Fale com a especialista"
        subtitle="Envie sua necessidade de consultoria, revisão de caso agrícola ou avaliação para agricultura orgânica. Se preferir, anexe fotos ou grave um áudio. O retorno será feito pelo canal informado para confirmar as informações."
      />

      <form onSubmit={handleSubmit} className={`relative ${formCardClass}`}>
        <HoneypotField value={website} onChange={setWebsite} />
        <fieldset disabled={submitting} className="grid min-w-0 gap-6">
          <FormSection title="Seus dados">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Nome" required>
                <input required autoComplete="name" value={form.name} onChange={(event) => update("name", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Telefone" required={isVisit}>
                <input required={isVisit} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="E-mail">
                <input type="email" autoComplete="email" value={form.email} onChange={(event) => update("email", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Tipo de solicitação">
                <select value={form.requestType} onChange={(event) => update("requestType", event.target.value)} className={inputClass}>
                  {CONTACT_REQUEST_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Cidade" required={isVisit}>
                <input required={isVisit} autoComplete="address-level2" value={form.city} onChange={(event) => update("city", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Estado (UF)" required={isVisit}>
                <input
                  required={isVisit}
                  maxLength={2}
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(event) => update("state", event.target.value.toUpperCase())}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Data desejada" required={isVisit} hint={isVisit ? undefined : "Opcional, para visitas."}>
                <input required={isVisit} type="date" value={form.preferredDate} onChange={(event) => update("preferredDate", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Horário desejado" required={isVisit} hint={isVisit ? undefined : "Opcional, para visitas."}>
                <input required={isVisit} placeholder="Ex.: 9h ou período da manhã" value={form.preferredTime} onChange={(event) => update("preferredTime", event.target.value)} className={inputClass} />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Sua necessidade">
            <div className="min-w-0">
              <FormField label="Mensagem / descrição da necessidade">
                <textarea
                  rows={6}
                  maxLength={4000}
                  value={form.message}
                  onChange={(event) => update("message", event.target.value)}
                  className={inputClass}
                  placeholder="Descreva a cultura, propriedade, problema observado ou objetivo da consultoria."
                />
              </FormField>
              <AiWritingAssistant message={form.message} onApply={(text) => update("message", text)} buildPayload={buildAiPayload} disabled={submitting} />
            </div>
          </FormSection>

          <RequestAttachments images={images} setImages={setImages} audio={audio} setAudio={setAudio} onRecordingChange={setRecording} disabled={submitting} />

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

          <SubmitButton label="Enviar solicitação" submitting={submitting} progress={progress} />
        </fieldset>
      </form>
    </section>
  );
}

"use client";

/**
 * Envio dos formularios publicos: bloqueio de envio duplicado, chave de
 * idempotencia por rascunho, progresso de upload e mensagens de erro amigaveis.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RequestTransportError, createSubmissionKey, postFormWithProgress } from "../../lib/public-requests/client";

type SubmitOptions = {
  trackProgress?: boolean;
  fallbackSuccess: string;
  fallbackError: string;
  /**
   * Chamado quando o servidor recusa o envio. Retorne true se o formulario ja
   * exibiu o erro (ex.: junto ao campo), para nao repetir no alerta geral.
   */
  onRejected?: (payload: Record<string, unknown> | null, status: number) => boolean;
};

export function usePublicRequestSubmit(prefix: string) {
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const keyRef = useRef("");
  const inFlightRef = useRef(false);

  const submit = useCallback(
    async (url: string, formData: FormData, options: SubmitOptions): Promise<Record<string, unknown> | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setSubmitting(true);
      setError("");
      setSuccess("");
      setProgress(options.trackProgress ? 0 : null);

      // A mesma chave e reutilizada em novas tentativas do mesmo rascunho: se a
      // resposta anterior se perdeu (timeout/queda), o servidor nao duplica.
      if (!keyRef.current) keyRef.current = createSubmissionKey(prefix);
      formData.set("submissionKey", keyRef.current);

      try {
        const result = await postFormWithProgress(url, formData, {
          headers: { "Idempotency-Key": keyRef.current },
          onProgress: options.trackProgress ? (fraction) => setProgress(fraction) : undefined,
          timeoutMs: 120000
        });
        const payloadError = typeof result.payload?.error === "string" ? result.payload.error : "";

        if (!result.ok) {
          if (options.onRejected?.(result.payload ?? null, result.status)) return null;
          if (result.status === 413) setError(payloadError || "Os anexos excedem o limite permitido. Remova algum arquivo e tente novamente.");
          else if (result.status === 429) setError(payloadError || "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
          else setError(payloadError || options.fallbackError);
          return null;
        }

        keyRef.current = "";
        setSuccess(typeof result.payload?.message === "string" && result.payload.message ? result.payload.message : options.fallbackSuccess);
        return result.payload ?? {};
      } catch (cause) {
        if (cause instanceof RequestTransportError && cause.kind === "timeout") {
          setError("O envio demorou mais que o esperado. Tente novamente: se a solicitação já tiver sido registrada, ela não será duplicada.");
        } else {
          setError("Sem conexão com o servidor. Verifique sua internet e tente novamente. Seus dados continuam preenchidos.");
        }
        return null;
      } finally {
        inFlightRef.current = false;
        setSubmitting(false);
        setProgress(null);
      }
    },
    [prefix]
  );

  return { submitting, progress, error, success, setError, setSuccess, submit };
}

/** Pede confirmacao ao sair/recarregar a pagina com dados nao enviados. */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}

"use client";

/**
 * Assistente de escrita com IA: sugere uma versao organizada da mensagem.
 * A sugestao so entra no campo quando o usuario clica em "Usar sugestão", pode
 * ser desfeita e editada livremente. Nunca envia o formulario.
 */

import { useEffect, useRef, useState } from "react";
import { requestAiSuggestion } from "../../lib/public-requests/client";
import { compactPrimaryButtonClass, secondaryButtonClass } from "./styles";

type Props = {
  message: string;
  onApply: (text: string) => void;
  /** Contexto enviado ao servidor (sem dados pessoais de contato). */
  buildPayload: () => Record<string, unknown>;
  disabled?: boolean;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "suggestion"; text: string }
  | { status: "error"; message: string };

export default function AiWritingAssistant({ message, onApply, buildPayload, disabled = false }: Props) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [applied, setApplied] = useState<{ previous: string; text: string } | null>(null);
  const mountedRef = useRef(true);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Se o usuario editar o texto depois de aplicar a sugestao, o "Desfazer" some
  // para nao sobrescrever as edicoes dele.
  useEffect(() => {
    if (applied && message !== applied.text) setApplied(null);
  }, [applied, message]);

  const hasText = message.trim().length > 0;
  const loading = state.status === "loading";

  async function generate() {
    if (loading) return;
    setState({ status: "loading" });

    try {
      const text = await requestAiSuggestion({ ...buildPayload(), message });
      if (!mountedRef.current) return;
      setState({ status: "suggestion", text });
      window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "O assistente de IA está indisponível no momento. Você pode escrever e enviar normalmente."
      });
    }
  }

  function applySuggestion(text: string) {
    setApplied({ previous: message, text });
    onApply(text);
    setState({ status: "idle" });
  }

  function undo() {
    if (!applied) return;
    onApply(applied.previous);
    setApplied(null);
  }

  return (
    <div className="mt-3 min-w-0" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={disabled || loading} aria-busy={loading} className={secondaryButtonClass}>
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-leaf-200 border-t-leaf-700" aria-hidden="true" />
              Gerando sugestão...
            </>
          ) : (
            <>
              <span aria-hidden="true">✨</span>
              {hasText ? "Melhorar texto com IA" : "Escrever com ajuda da IA"}
            </>
          )}
        </button>
        <span className="text-xs leading-5 text-slate-500">
          {hasText ? "A IA organiza e deixa seu texto mais claro. Você revisa antes de enviar." : "Preencha os campos acima e a IA monta um rascunho para você completar."}
        </span>
      </div>

      {applied ? (
        <p className="mt-2 text-xs leading-5 text-leaf-800">
          Sugestão aplicada. Revise e complete os trechos entre colchetes, se houver.{" "}
          <button type="button" onClick={undo} className="font-bold underline underline-offset-2">
            Desfazer
          </button>
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{state.message}</p>
      ) : null}

      {state.status === "suggestion" ? (
        <div ref={panelRef} className="mt-3 rounded-2xl border border-leaf-200 bg-leaf-50 p-4">
          <p className="text-sm font-bold text-moss-800">Sugestão da IA</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Confira se tudo está correto. Trechos entre [colchetes] são informações para você completar.
          </p>
          <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-leaf-100 bg-white p-3 text-sm leading-6 text-slate-800">
            {state.text}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => applySuggestion(state.text)} disabled={disabled} className={compactPrimaryButtonClass}>
              Usar sugestão
            </button>
            <button type="button" onClick={generate} disabled={disabled} className={secondaryButtonClass}>
              Gerar outra
            </button>
            <button type="button" onClick={() => setState({ status: "idle" })} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
              Descartar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

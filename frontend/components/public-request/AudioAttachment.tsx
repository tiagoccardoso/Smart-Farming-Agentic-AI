"use client";

/**
 * Mensagem de voz: gravacao pelo navegador (MediaRecorder) ou envio de arquivo.
 * O microfone so e solicitado quando o usuario clica em "Gravar áudio". Antes
 * de enviar, o audio pode ser ouvido, excluido e gravado novamente.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ATTACHMENT_LIMITS, AUDIO_INPUT_ACCEPT, formatBytes, formatDuration } from "../../lib/public-requests/config";
import { audioExtensionFor, isAudioRecordingSupported, pickRecorderMimeType, validateAudioFile } from "../../lib/public-requests/client";
import { dangerLinkClass, secondaryButtonClass } from "./styles";

export type AudioValue = {
  file: File;
  url: string;
  durationSeconds: number | null;
  origin: "recording" | "upload";
};

type Props = {
  value: AudioValue | null;
  onChange: (value: AudioValue | null) => void;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
};

type Phase = "idle" | "requesting" | "recording" | "processing";

function microphoneErrorMessage(error: unknown) {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permissão do microfone negada. Libere o acesso nas configurações do navegador ou envie um arquivo de áudio.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Nenhum microfone foi encontrado neste dispositivo. Você pode enviar um arquivo de áudio.";
  }
  if (name === "NotReadableError") {
    return "O microfone está sendo usado por outro aplicativo. Feche-o e tente novamente.";
  }
  return "Não foi possível iniciar a gravação neste navegador. Você pode enviar um arquivo de áudio.";
}

export default function AudioAttachment({ value, onChange, onRecordingChange, disabled = false }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [recordingSupported, setRecordingSupported] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setRecordingSupported(isAudioRecordingSupported());
  }, []);

  useEffect(() => {
    onRecordingChange?.(phase === "recording" || phase === "requesting");
  }, [phase, onRecordingChange]);

  useEffect(
    () => () => {
      discardRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (valueRef.current?.url) URL.revokeObjectURL(valueRef.current.url);
    },
    []
  );

  function clearTimer() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function replaceValue(next: AudioValue | null) {
    const previous = valueRef.current;
    if (previous?.url && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
    valueRef.current = next;
    onChange(next);
  }

  async function startRecording() {
    if (phase !== "idle" || disabled) return;
    setError("");
    setPhase("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        clearTimer();
        releaseStream();
        const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);

        if (discardRef.current) {
          chunksRef.current = [];
          setPhase("idle");
          return;
        }

        const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];

        if (blob.size === 0) {
          setError("A gravação ficou vazia. Tente gravar novamente.");
          setPhase("idle");
          return;
        }

        if (blob.size > ATTACHMENT_LIMITS.maxAudioBytes) {
          setError(`A gravação ficou maior que ${formatBytes(ATTACHMENT_LIMITS.maxAudioBytes)}. Grave uma mensagem mais curta.`);
          setPhase("idle");
          return;
        }

        const file = new File([blob], `mensagem-de-voz.${audioExtensionFor(type)}`, { type, lastModified: Date.now() });
        replaceValue({ file, url: URL.createObjectURL(file), durationSeconds: Math.min(elapsed, ATTACHMENT_LIMITS.maxAudioSeconds), origin: "recording" });
        setPhase("idle");
      };

      recorder.onerror = () => {
        discardRef.current = true;
        setError("A gravação foi interrompida. Tente novamente.");
        if (recorder.state === "recording") recorder.stop();
        else {
          clearTimer();
          releaseStream();
          setPhase("idle");
        }
      };

      recorderRef.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= ATTACHMENT_LIMITS.maxAudioSeconds && recorder.state === "recording") {
          recorder.stop();
        }
      }, 250);
    } catch (cause) {
      releaseStream();
      setError(microphoneErrorMessage(cause));
      setPhase("idle");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      setPhase("processing");
      recorderRef.current.stop();
    }
  }

  function cancelRecording() {
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      clearTimer();
      releaseStream();
      setPhase("idle");
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setPhase("processing");

    try {
      const { duration } = await validateAudioFile(file);
      replaceValue({ file, url: URL.createObjectURL(file), durationSeconds: duration, origin: "upload" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível usar este arquivo de áudio.");
    } finally {
      setPhase("idle");
    }
  }

  function removeAudio() {
    replaceValue(null);
    setError("");
  }

  const busy = phase !== "idle";
  const maxMinutes = Math.round(ATTACHMENT_LIMITS.maxAudioSeconds / 60);

  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-800">Mensagem de voz</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Prefere falar? Grave até {maxMinutes} minutos ou envie um arquivo de áudio (máx. {formatBytes(ATTACHMENT_LIMITS.maxAudioBytes)}).
      </p>

      <input ref={fileInputRef} type="file" accept={AUDIO_INPUT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFile} disabled={disabled || busy} />

      {phase === "recording" || phase === "requesting" ? (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
          <span className="flex items-center gap-3 text-sm font-semibold text-red-800">
            <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            {phase === "requesting" ? "Aguardando permissão do microfone..." : `Gravando ${formatDuration(seconds)} / ${formatDuration(ATTACHMENT_LIMITS.maxAudioSeconds)}`}
          </span>
          <span className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={stopRecording} disabled={phase !== "recording"} className="inline-flex min-h-11 items-center justify-center rounded-full bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
              Parar gravação
            </button>
            <button type="button" onClick={cancelRecording} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100">
              Cancelar
            </button>
          </span>
        </div>
      ) : value ? (
        <div className="mt-3 rounded-2xl border border-leaf-100 bg-leaf-50 p-3 sm:p-4">
          <audio controls preload="metadata" src={value.url} className="w-full max-w-full">
            <track kind="captions" />
            Seu navegador não reproduz este áudio.
          </audio>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-600">
              {value.origin === "recording" ? "Gravação" : "Arquivo"}
              {value.durationSeconds ? ` · ${formatDuration(value.durationSeconds)}` : ""} · {formatBytes(value.file.size)}
            </span>
            <span className="flex flex-wrap gap-1">
              {recordingSupported ? (
                <button type="button" onClick={startRecording} disabled={disabled} className={secondaryButtonClass}>
                  Gravar novamente
                </button>
              ) : null}
              <button type="button" onClick={removeAudio} disabled={disabled} className={dangerLinkClass}>
                Excluir áudio
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
          {recordingSupported ? (
            <button type="button" onClick={startRecording} disabled={disabled || busy} className={`${secondaryButtonClass} w-full sm:w-auto`}>
              <span className="h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />
              Gravar áudio
            </button>
          ) : null}
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || busy} className={`${secondaryButtonClass} w-full sm:w-auto`}>
            {phase === "processing" ? "Verificando áudio..." : "Enviar arquivo de áudio"}
          </button>
        </div>
      )}

      {error ? <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800" role="alert">{error}</p> : null}
    </div>
  );
}

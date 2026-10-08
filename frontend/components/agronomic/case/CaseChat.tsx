"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import AudioAttachment, { type AudioValue } from "../../public-request/AudioAttachment";
import { buildChatTimeline, chatErrorMessage, type ChatMessageRow } from "../../../lib/agronomic/case-chat";
import { CASE_ATTACHMENT_LIMITS, PHOTO_INPUT_ACCEPT, formatFileSize } from "../../../lib/agronomic/case-attachments";
import { createClientId, prepareCasePhoto } from "../../../lib/agronomic/client-files";
import { RequestTransportError, postFormWithProgress } from "../../../lib/public-requests/client";
import { parseChatMarkdown, type InlineSegment } from "../../../lib/agronomic/chat-markdown";
import ImageLightbox, { type LightboxImage } from "./ImageLightbox";
import { IconCamera, IconChat, IconClose, IconImage, IconMic, IconRetry, IconSend, IconSparkle, IconUser } from "./icons";

type PendingImage = { id: string; file: File; url: string };

type ChatError = { message: string; retry: "resend" | "assistant" | null };

/** Pergunta exibida na hora do envio, antes da confirmação do servidor. */
type OptimisticTurn = { id: string; text: string; imageUrls: string[]; hasAudio: boolean };

const QUICK_PROMPTS = [
  "Explique a análise em linguagem simples.",
  "Que informações faltam para aumentar a confiança?",
  "O que devo observar nos próximos dias?",
];

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function Inline({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.bold ? <strong key={index} className="font-bold">{segment.text}</strong> : segment.italic ? <em key={index}>{segment.text}</em> : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}

/** Resposta da IA em Markdown simples (listas numeradas preservam o número). */
function MessageText({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text);
  if (!blocks.length) return null;
  return (
    <div className="space-y-2 break-words [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <p key={index} className="font-bold text-slate-900"><Inline segments={block.segments} /></p>;
        if (block.type === "paragraph") return <p key={index}><Inline segments={block.segments} /></p>;
        if (block.type === "numbered") {
          return (
            <ol key={index} start={block.start} className="list-decimal space-y-1 pl-5 marker:font-bold marker:text-leaf-700">
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><Inline segments={item} /></li>)}
            </ol>
          );
        }
        return (
          <ul key={index} className="space-y-1 pl-1">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2">
                <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
                <span className="min-w-0"><Inline segments={item} /></span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function UserText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</p>;
}

export default function CaseChat({
  caseId,
  initialMessages,
  getAccessToken,
}: {
  caseId: string;
  initialMessages: ChatMessageRow[];
  getAccessToken: () => string | null;
}) {
  const [rows, setRows] = useState<ChatMessageRow[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [audio, setAudio] = useState<AudioValue | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticTurn | null>(null);
  // Caso ativo e trava de envio: respostas que chegam depois de trocar de caso
  // são descartadas, e um duplo clique não dispara dois envios.
  const activeCaseRef = useRef(caseId);
  activeCaseRef.current = caseId;
  const sendingRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const messageKeyRef = useRef<string | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Conversa exclusiva do caso: ao trocar de caso, o estado recomeça.
  useEffect(() => {
    setRows(initialMessages);
    setDraft("");
    setError(null);
    setNotice(null);
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.url));
      return [];
    });
    setAudio(null);
    setShowRecorder(false);
    setOptimistic(null);
    messageKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  const timeline = useMemo(() => buildChatTimeline(rows), [rows]);
  const awaitingAssistant = rows.length > 0 && rows[rows.length - 1].role === "user";
  const lightboxImages: LightboxImage[] = useMemo(
    () => timeline.filter((item) => item.kind === "image").map((item) => ({ id: item.id, url: (item as { url: string }).url, label: "Foto enviada no chat" })),
    [timeline],
  );

  // Rolagem só dentro da caixa do chat; a página não se move.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [timeline.length, sending, optimistic]);

  const canSend = !sending && !preparing && !recording && Boolean(draft.trim() || images.length || audio);

  async function handleImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const room = CASE_ATTACHMENT_LIMITS.maxChatImages - images.length;
    if (room <= 0) {
      setNotice(`Envie até ${CASE_ATTACHMENT_LIMITS.maxChatImages} fotos por mensagem.`);
      return;
    }
    setPreparing(true);
    setNotice(null);
    const accepted: PendingImage[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const prepared = await prepareCasePhoto(file);
        accepted.push({ id: createClientId("img"), file: prepared, url: URL.createObjectURL(prepared) });
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : `Não foi possível usar "${file.name}".`);
      }
    }
    if (files.length > room) setNotice(`Somente ${CASE_ATTACHMENT_LIMITS.maxChatImages} fotos por mensagem. As demais não foram adicionadas.`);
    const total = [...images, ...accepted].reduce((sum, image) => sum + image.file.size, 0) + (audio?.file.size ?? 0);
    if (total > CASE_ATTACHMENT_LIMITS.maxChatImagesTotalBytes) {
      accepted.forEach((image) => URL.revokeObjectURL(image.url));
      setNotice("As fotos selecionadas ficaram grandes demais para uma mensagem. Envie em mensagens separadas.");
    } else {
      setImages((current) => [...current, ...accepted]);
      messageKeyRef.current = null;
    }
    setPreparing(false);
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((image) => image.id !== id);
    });
    messageKeyRef.current = null;
  }

  const applyResponse = useCallback((payload: Record<string, unknown> | null) => {
    if (Array.isArray(payload?.messages)) setRows(payload!.messages as ChatMessageRow[]);
    const transcription = payload?.transcription as { status?: string } | null | undefined;
    if (transcription?.status === "failed") setNotice("O áudio foi salvo, mas a transcrição automática não foi concluída.");
    if (transcription?.status === "unavailable") setNotice("O áudio foi salvo. A transcrição automática não está disponível no momento.");
    if (typeof payload?.aiError === "string" && payload.aiError) {
      setError({ message: payload.aiError, retry: "assistant" });
    }
  }, []);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || sendingRef.current) return;
    const token = getAccessToken();
    if (!token) {
      setError({ message: "Sua sessão expirou. Faça login novamente; sua mensagem continua no campo.", retry: null });
      return;
    }

    const text = draft.trim();
    const sentImageIds = images.map((image) => image.id);
    const sentAudio = audio;
    const body = new FormData();
    if (text) body.append("message", text);
    images.forEach((image) => body.append("images", image.file, image.file.name));
    if (audio) body.append("audio", audio.file, audio.file.name);
    // Mesma chave em uma nova tentativa: o servidor não duplica arquivos.
    messageKeyRef.current = messageKeyRef.current ?? createClientId("msg");
    body.append("clientMessageId", messageKeyRef.current);

    const sentCaseId = caseId;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setNotice(null);
    setOptimistic({ id: messageKeyRef.current, text, imageUrls: images.map((image) => image.url), hasAudio: Boolean(audio) });
    setProgress(images.length || audio ? 0 : null);
    setStatusText(images.length ? (images.length > 1 ? "Enviando imagens..." : "Enviando imagem...") : audio ? "Processando áudio..." : "A IA está preparando a resposta...");

    try {
      const result = await postFormWithProgress(`/api/agronomic-cases/${encodeURIComponent(caseId)}/chat`, body, {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 90000,
        onProgress: (fraction) => {
          setProgress(fraction);
          if (fraction >= 1) setStatusText(audio ? "Processando áudio e preparando a resposta..." : "A IA está preparando a resposta...");
        },
      });

      if (activeCaseRef.current !== sentCaseId) return;

      if (!result.ok) {
        // Nada é descartado: texto, fotos e áudio continuam no campo.
        setError({ message: chatErrorMessage(result.status, typeof result.payload?.error === "string" ? result.payload.error : null), retry: result.status === 402 ? null : "resend" });
        return;
      }

      // Servidor confirmou a gravação: limpa só o que foi enviado (o que o
      // usuário digitou ou anexou durante o envio continua no campo).
      setDraft((current) => (current.trim() === text ? "" : current));
      setImages((current) => {
        current.filter((image) => sentImageIds.includes(image.id)).forEach((image) => URL.revokeObjectURL(image.url));
        return current.filter((image) => !sentImageIds.includes(image.id));
      });
      setAudio((current) => (current === sentAudio ? null : current));
      if (sentAudio) setShowRecorder(false);
      messageKeyRef.current = null;
      applyResponse(result.payload);
    } catch (cause) {
      if (activeCaseRef.current !== sentCaseId) return;
      const timeout = cause instanceof RequestTransportError && cause.kind === "timeout";
      setError({
        message: timeout
          ? "A resposta demorou demais. Sua mensagem pode ter sido salva; toque em Tentar novamente (não haverá duplicação)."
          : "Sem conexão com o servidor. Sua mensagem continua no campo; tente novamente.",
        retry: "resend",
      });
    } finally {
      sendingRef.current = false;
      setOptimistic(null);
      setSending(false);
      setProgress(null);
      setStatusText(null);
    }
  }

  async function retryAssistant() {
    const token = getAccessToken();
    if (!token || sending || sendingRef.current) return;
    const sentCaseId = caseId;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setStatusText("A IA está preparando a resposta...");
    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ retry: true }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (activeCaseRef.current !== sentCaseId) return;
      if (!response.ok) {
        setError({ message: chatErrorMessage(response.status, typeof payload?.error === "string" ? payload.error : null), retry: response.status === 402 ? null : "assistant" });
        return;
      }
      applyResponse(payload);
    } catch {
      if (activeCaseRef.current === sentCaseId) setError({ message: "Sem conexão com o servidor. Tente novamente.", retry: "assistant" });
    } finally {
      sendingRef.current = false;
      setSending(false);
      setStatusText(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Desktop: Enter envia, Shift+Enter quebra linha. No celular o botão envia.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      event.preventDefault();
      void send();
    }
  }

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  let imageCounter = -1;

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-leaf-200 bg-white shadow-soft" aria-labelledby={`chat-title-${caseId}`} data-testid="case-chat">
      <div className="border-b border-leaf-100 bg-gradient-to-r from-leaf-50 via-white to-gold-50/60 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-leaf-700 text-white"><IconChat className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h3 id={`chat-title-${caseId}`} className="text-lg font-black text-slate-950">Converse com a IA sobre este caso</h3>
            <p className="mt-0.5 text-sm leading-6 text-slate-600">Tire dúvidas, conte novidades e envie fotos ou áudios. Tudo fica salvo neste caso e complementa a avaliação.</p>
          </div>
        </div>
      </div>

      <div ref={listRef} className="max-h-[min(60vh,520px)] min-h-[180px] space-y-3 overflow-y-auto overscroll-contain bg-slate-50/70 px-3 py-4 sm:px-5" aria-live="polite" aria-busy={sending} data-testid="chat-messages">
        {timeline.length === 0 ? (
          <div className="mx-auto max-w-md py-6 text-center">
            <p className="font-bold text-slate-800">Nenhuma mensagem ainda</p>
            <p className="mt-1 text-sm text-slate-500">Comece com uma pergunta ou use uma sugestão abaixo.</p>
          </div>
        ) : (
          timeline.map((item) => {
            const mine = item.role === "user";
            const bubble = mine ? "bg-leaf-700 text-white rounded-br-md" : "bg-white text-slate-700 ring-1 ring-slate-200 rounded-bl-md";
            if (item.kind === "image") imageCounter += 1;
            const thisImageIndex = imageCounter;
            return (
              <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[0.95rem] leading-6 shadow-sm sm:max-w-[78%] ${bubble}`}>
                  <p className={`mb-1 flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide ${mine ? "text-white/70" : "text-slate-400"}`}>
                    {mine ? <IconUser className="h-3.5 w-3.5" /> : <IconSparkle className="h-3.5 w-3.5" />}
                    {mine ? "Você" : "IA PlantaSa"}
                    {item.createdAt ? <span className="font-medium normal-case tracking-normal opacity-80">· {formatTime(item.createdAt)}</span> : null}
                  </p>
                  {item.kind === "text" ? mine ? <UserText text={item.text} /> : <MessageText text={item.text} /> : null}
                  {item.kind === "image" ? (
                    <button type="button" onClick={() => setLightboxIndex(thisImageIndex)} className="block overflow-hidden rounded-xl" aria-label="Ampliar foto enviada">
                      {/* eslint-disable-next-line @next/next/no-img-element -- storage do Supabase */}
                      <img src={item.url} alt="Foto enviada no chat" loading="lazy" className="h-40 w-full max-w-[16rem] object-cover sm:h-48" />
                      {item.caption ? <span className="block px-1 pt-1.5 text-left text-sm">{item.caption}</span> : null}
                    </button>
                  ) : null}
                  {item.kind === "audio" ? (
                    <div className="space-y-2">
                      {item.url ? (
                        <audio controls preload="metadata" src={item.url} className="w-[15rem] max-w-full">
                          <track kind="captions" />
                        </audio>
                      ) : null}
                      {item.transcription ? (
                        <p className={`rounded-xl px-2.5 py-1.5 text-sm ${mine ? "bg-white/10" : "bg-slate-50"}`}><span className="font-bold">Transcrição: </span>{item.transcription}</p>
                      ) : (
                        <p className={`text-xs ${mine ? "text-white/75" : "text-slate-500"}`}>Transcrição não concluída. O áudio original está salvo.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        {optimistic ? (
          <div className="flex justify-end" data-testid="chat-optimistic">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-leaf-700/90 px-3.5 py-2.5 text-[0.95rem] leading-6 text-white shadow-sm sm:max-w-[78%]">
              <p className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-white/70">
                <IconUser className="h-3.5 w-3.5" /> Você <span className="font-medium normal-case tracking-normal opacity-80">· enviando</span>
              </p>
              {optimistic.imageUrls.length ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {optimistic.imageUrls.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element -- prévia local
                    <img key={url} src={url} alt="Foto sendo enviada" className="h-20 w-20 rounded-lg object-cover opacity-90" />
                  ))}
                </div>
              ) : null}
              {optimistic.hasAudio ? <p className="text-sm text-white/85">Mensagem de áudio</p> : null}
              {optimistic.text ? <UserText text={optimistic.text} /> : null}
            </div>
          </div>
        ) : null}
        {sending ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200" role="status">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-500 [animation-delay:-0.2s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-500 [animation-delay:-0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-500" />
              </span>
              {statusText || "Analisando as informações..."}
              {progress !== null && progress < 1 ? <span className="tabular-nums text-slate-400">{Math.round(progress * 100)}%</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-col gap-2 border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span className="leading-6">{error.message}</span>
          {error.retry ? (
            <button type="button" onClick={() => (error.retry === "assistant" ? retryAssistant() : send())} disabled={sending} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700 disabled:opacity-60">
              <IconRetry className="h-4 w-4" /> Tentar novamente
            </button>
          ) : null}
        </div>
      ) : awaitingAssistant && !sending ? (
        <div className="flex flex-col gap-2 border-t border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Sua última mensagem ainda está sem resposta da IA.</span>
          <button type="button" onClick={retryAssistant} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 font-bold hover:bg-amber-100">
            <IconRetry className="h-4 w-4" /> Gerar resposta
          </button>
        </div>
      ) : null}
      {notice ? <p className="border-t border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-sky-900" role="status">{notice}</p> : null}

      <form onSubmit={send} className="space-y-3 border-t border-slate-100 bg-white px-3 py-3 sm:px-5">
        {timeline.length < 2 && !draft ? (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {QUICK_PROMPTS.map((prompt) => (
              <button key={prompt} type="button" onClick={() => { setDraft(prompt); textareaRef.current?.focus({ preventScroll: true }); }} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-leaf-300">
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {images.length ? (
          <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Fotos para enviar">
            {images.map((image) => (
              <li key={image.id} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- pré-visualização local */}
                <img src={image.url} alt={`Prévia ${image.file.name}`} className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[0.65rem] font-semibold text-white">{formatFileSize(image.file.size)}</span>
                <button type="button" onClick={() => removeImage(image.id)} disabled={sending} className="absolute -right-1.5 -top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow" aria-label={`Remover ${image.file.name}`}>
                  <IconClose className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {showRecorder || audio ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <AudioAttachment value={audio} onChange={(value) => { setAudio(value); messageKeyRef.current = null; }} onRecordingChange={setRecording} disabled={sending} />
              </div>
              {!audio && !recording ? (
                <button type="button" onClick={() => setShowRecorder(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200" aria-label="Fechar gravador">
                  <IconClose className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <input ref={galleryRef} type="file" accept={PHOTO_INPUT_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleImages} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleImages} />

        <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:flex">
          <div className="col-span-2 min-w-0 sm:order-2 sm:flex-1">
            <label className="sr-only" htmlFor={`chat-input-${caseId}`}>Mensagem para a IA</label>
            <textarea
              id={`chat-input-${caseId}`}
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={4000}
              {...{ enterkeyhint: "send" }}
              placeholder={images.length ? "Comente as fotos (opcional)..." : "Escreva sua dúvida ou novidade..."}
              className="min-h-[2.75rem] w-full min-w-0 resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-base leading-6 outline-none focus:border-leaf-400 sm:text-[0.95rem]"
            />
          </div>
          <div className="flex shrink-0 gap-1 sm:order-1">
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={sending || preparing} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:border-leaf-300 hover:text-leaf-700 disabled:opacity-50" aria-label="Anexar fotos da galeria" title="Fotos da galeria">
              <IconImage className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={sending || preparing} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:border-leaf-300 hover:text-leaf-700 disabled:opacity-50" aria-label="Tirar foto com a câmera" title="Câmera">
              <IconCamera className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => setShowRecorder(true)} disabled={sending || Boolean(audio)} aria-pressed={showRecorder} className={`inline-flex h-11 w-11 items-center justify-center rounded-full border ${showRecorder ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-slate-600 hover:border-leaf-300 hover:text-leaf-700"} disabled:opacity-50`} aria-label="Gravar ou enviar áudio" title="Áudio">
              <IconMic className="h-5 w-5" />
            </button>
          </div>
          <button type="submit" disabled={!canSend} className="inline-flex h-11 shrink-0 justify-self-end sm:order-3 items-center justify-center gap-2 rounded-full bg-leaf-600 px-4 font-bold text-white shadow-sm hover:bg-leaf-700 disabled:bg-slate-300" aria-label="Enviar mensagem">
            <IconSend className="h-5 w-5" />
            <span>Enviar</span>
          </button>
        </div>
        {preparing ? <p className="text-xs font-semibold text-slate-500">Preparando fotos...</p> : null}
      </form>

      <ImageLightbox images={lightboxImages} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndexChange={setLightboxIndex} />
    </section>
  );
}

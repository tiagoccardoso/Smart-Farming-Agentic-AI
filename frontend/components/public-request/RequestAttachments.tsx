"use client";

import type { Dispatch, SetStateAction } from "react";
import { ATTACHMENT_LIMITS, formatBytes } from "../../lib/public-requests/config";
import AudioAttachment, { type AudioValue } from "./AudioAttachment";
import FormSection from "./FormSection";
import ImageAttachments, { type ImageItem } from "./ImageAttachments";

type Props = {
  images: ImageItem[];
  setImages: Dispatch<SetStateAction<ImageItem[]>>;
  audio: AudioValue | null;
  setAudio: (value: AudioValue | null) => void;
  onRecordingChange: (recording: boolean) => void;
  disabled?: boolean;
};

/** Secao "Anexos" comum aos formularios de Contato e Orcamento. */
export default function RequestAttachments({ images, setImages, audio, setAudio, onRecordingChange, disabled = false }: Props) {
  return (
    <FormSection
      title="Fotos e áudio (opcional)"
      description="Fotos da área, das plantas ou do problema e uma mensagem de voz ajudam a especialista a entender sua necessidade."
    >
      <ImageAttachments items={images} setItems={setImages} disabled={disabled} />
      <AudioAttachment value={audio} onChange={setAudio} onRecordingChange={onRecordingChange} disabled={disabled} />
    </FormSection>
  );
}

export function readyImageFiles(images: ImageItem[]) {
  return images.flatMap((item) => (item.status === "ready" && item.file ? [item.file] : []));
}

/** Motivo que impede o envio agora (processamento, gravacao ou limite total). */
export function getAttachmentBlocker(images: ImageItem[], audio: AudioValue | null, recording: boolean) {
  if (recording) return "Finalize ou cancele a gravação do áudio antes de enviar.";
  if (images.some((item) => item.status === "processing")) return "Aguarde a preparação das imagens antes de enviar.";
  if (images.some((item) => item.status === "error")) return "Remova as imagens com erro antes de enviar.";

  const total = readyImageFiles(images).reduce((sum, file) => sum + file.size, 0) + (audio?.file.size ?? 0);
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
    return `Os anexos somam ${formatBytes(total)}; o limite é ${formatBytes(ATTACHMENT_LIMITS.maxTotalBytes)}. Remova algum arquivo.`;
  }

  return "";
}

export function appendAttachments(formData: FormData, images: ImageItem[], audio: AudioValue | null) {
  readyImageFiles(images).forEach((file) => formData.append("images", file, file.name));
  if (audio) {
    formData.append("audio", audio.file, audio.file.name);
    if (audio.durationSeconds) formData.append("audioDuration", String(Math.round(audio.durationSeconds)));
  }
  return readyImageFiles(images).length + (audio ? 1 : 0);
}

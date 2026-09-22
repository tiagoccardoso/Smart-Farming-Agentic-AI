"use client";

/**
 * Anexo de imagens: galeria/camera (reutiliza MobileImagePicker), otimizacao no
 * navegador, preview, remocao e estados de processamento/erro. O servidor
 * revalida formato e tamanho de cada arquivo.
 */

import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import MobileImagePicker from "../MobileImagePicker";
import { ATTACHMENT_LIMITS, IMAGE_INPUT_ACCEPT, formatBytes } from "../../lib/public-requests/config";
import { optimizeImageFile } from "../../lib/public-requests/client";

export type ImageItem = {
  id: string;
  name: string;
  status: "processing" | "ready" | "error";
  file: File | null;
  previewUrl: string | null;
  error?: string;
};

type Props = {
  items: ImageItem[];
  setItems: Dispatch<SetStateAction<ImageItem[]>>;
  disabled?: boolean;
};

let sequence = 0;
function nextId() {
  sequence += 1;
  return `img-${Date.now()}-${sequence}`;
}

export function revokeImageItems(items: ImageItem[]) {
  items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
}

export default function ImageAttachments({ items, setItems, disabled = false }: Props) {
  const [notice, setNotice] = useState("");
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => () => revokeImageItems(itemsRef.current), []);

  const activeCount = items.filter((item) => item.status !== "error").length;
  const remaining = ATTACHMENT_LIMITS.maxImages - activeCount;

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    setNotice("");
    if (selected.length === 0) return;

    const accepted = selected.slice(0, Math.max(0, remaining));
    if (selected.length > accepted.length) {
      setNotice(`Você pode anexar até ${ATTACHMENT_LIMITS.maxImages} imagens. ${selected.length - accepted.length} imagem(ns) não foram adicionadas.`);
    }
    if (accepted.length === 0) return;

    const pending = accepted.map((file) => ({ id: nextId(), name: file.name || "imagem", status: "processing" as const, file: null, previewUrl: null, source: file }));
    setItems((current) => [...current, ...pending.map(({ source: _source, ...item }) => item)]);

    pending.forEach(async ({ id, source }) => {
      try {
        const optimized = await optimizeImageFile(source);
        const previewUrl = URL.createObjectURL(optimized);
        setItems((current) => {
          if (!current.some((item) => item.id === id)) {
            URL.revokeObjectURL(previewUrl);
            return current;
          }
          return current.map((item) => (item.id === id ? { ...item, status: "ready", file: optimized, previewUrl } : item));
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível preparar esta imagem.";
        setItems((current) => current.map((item) => (item.id === id ? { ...item, status: "error", error: message } : item)));
      }
    });
  }

  function remove(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
    setNotice("");
  }

  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-800">Imagens</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Até {ATTACHMENT_LIMITS.maxImages} fotos (JPG, PNG ou WEBP). Elas são otimizadas automaticamente antes do envio (máx. {formatBytes(ATTACHMENT_LIMITS.maxImageBytes)} cada).
      </p>

      <div className="mt-3">
        <MobileImagePicker
          accept={IMAGE_INPUT_ACCEPT}
          cameraAccept="image/*"
          multiple
          disabled={disabled || remaining <= 0}
          galleryLabel="Selecionar imagens"
          cameraLabel="Tirar foto"
          galleryAriaLabel="Selecionar imagens para anexar"
          cameraAriaLabel="Tirar foto para anexar"
          onGalleryChange={handleFiles}
          onCameraChange={handleFiles}
        />
      </div>

      {notice ? <p className="mt-2 text-xs leading-5 text-amber-800" role="status">{notice}</p> : null}

      {items.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Imagens anexadas">
          {items.map((item) => (
            <li key={item.id} className={`relative min-w-0 overflow-hidden rounded-2xl border ${item.status === "error" ? "border-red-200 bg-red-50" : "border-leaf-100 bg-leaf-50"}`}>
              <div className="flex aspect-square items-center justify-center">
                {item.status === "ready" && item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt={`Pré-visualização de ${item.name}`} className="h-full w-full object-cover" />
                ) : item.status === "processing" ? (
                  <span className="flex flex-col items-center gap-2 p-2 text-center text-xs text-slate-600" role="status">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-leaf-200 border-t-leaf-700" aria-hidden="true" />
                    Preparando...
                  </span>
                ) : (
                  <span className="p-3 text-center text-xs leading-5 text-red-800">{item.error}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-white/60 bg-white/90 px-2 py-1">
                <span className="min-w-0 truncate text-[11px] text-slate-600" title={item.name}>
                  {item.file ? formatBytes(item.file.size) : item.name}
                </span>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  disabled={disabled}
                  className="inline-flex min-h-9 shrink-0 items-center rounded-full px-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  aria-label={`Remover ${item.name}`}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

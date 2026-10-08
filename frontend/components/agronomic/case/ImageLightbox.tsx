"use client";

import { useEffect, useRef } from "react";
import { IconChevron, IconClose, IconExternal } from "./icons";

export type LightboxImage = { id: string; url: string; label?: string | null };

/**
 * Visualização ampliada de imagens. Trava a rolagem do fundo enquanto aberta e
 * devolve a página exatamente para a mesma posição ao fechar.
 */
export default function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = index !== null && Boolean(images[index]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index !== null) onIndexChange((index + 1) % images.length);
      if (event.key === "ArrowLeft" && index !== null) onIndexChange((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, index, images.length, onClose, onIndexChange]);

  if (!open || index === null) return null;
  const image = images[index];

  return (
    <div role="dialog" aria-modal="true" aria-label="Imagem ampliada" className="fixed inset-0 z-[70] flex flex-col bg-slate-950/95 text-white" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3" onClick={(event) => event.stopPropagation()}>
        <p className="min-w-0 truncate text-sm font-semibold">
          {image.label || "Imagem do caso"} <span className="text-white/60">· {index + 1} de {images.length}</span>
        </p>
        <div className="flex items-center gap-2">
          <a href={image.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Abrir imagem original em nova aba">
            <IconExternal className="h-5 w-5" />
          </a>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Fechar imagem">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4" onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URLs do storage do Supabase, sem domínio fixo para next/image. */}
        <img src={image.url} alt={image.label || "Imagem do caso ampliada"} className="max-h-full max-w-full rounded-lg object-contain" />
        {images.length > 1 ? (
          <>
            <button type="button" onClick={() => onIndexChange((index - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70" aria-label="Imagem anterior">
              <IconChevron className="h-6 w-6 rotate-90" />
            </button>
            <button type="button" onClick={() => onIndexChange((index + 1) % images.length)} className="absolute right-2 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70" aria-label="Próxima imagem">
              <IconChevron className="h-6 w-6 -rotate-90" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

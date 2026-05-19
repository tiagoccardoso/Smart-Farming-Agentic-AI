"use client";

import { useMemo, useState } from "react";

type HomeHeroImageProps = {
  src?: string | null;
  alt: string;
};

const fallbackImage = "/images/organic-consulting-premium.svg";

export default function HomeHeroImage({ src, alt }: HomeHeroImageProps) {
  const normalizedSrc = useMemo(() => {
    const value = (src ?? "").trim();
    return value.length > 0 ? value : fallbackImage;
  }, [src]);

  const [failed, setFailed] = useState(false);
  const resolvedSrc = failed ? fallbackImage : normalizedSrc;

  return (
    <div className="relative overflow-hidden rounded-[1.5rem] border border-white/90 bg-gradient-to-br from-[#F7F4EE] to-[#EEF6ED] shadow-[0_18px_40px_rgba(18,63,42,0.16)]">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL pode vir dinâmica do storage e precisa fallback de erro em runtime. */}
      <img
        src={resolvedSrc}
        alt={alt}
        onError={() => setFailed(true)}
        className="h-[260px] w-full object-cover object-center sm:h-[340px] lg:h-[620px]"
        loading="eager"
      />
      {failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
          <span className="rounded-full border border-[#123F2A]/20 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#123F2A]">
            Imagem indisponível no momento
          </span>
        </div>
      ) : null}
    </div>
  );
}

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[#e7e2d9]/40 bg-[#0F2F22] text-white">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-6 py-10 md:grid-cols-[1.4fr_1fr] md:items-center md:px-10">
        <div>
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-[#beeecf]">🌿</span>
            <p className="text-lg font-bold tracking-tight">Plantasã</p>
          </div>
          <p className="mt-3 max-w-xl text-center text-sm leading-6 text-white/70 md:text-left">
            Tecnologia, agronomia e orientação especializada para decisões no campo.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-semibold md:justify-end">
          <Link href="/culturas" className="text-white/65 transition hover:text-white">Culturas</Link>
          <Link href="/doencas" className="text-white/65 transition hover:text-white">Doenças</Link>
          <Link href="/agricultura-organica" className="text-white/65 transition hover:text-white">Agricultura Orgânica</Link>
          <Link href="/especialista" className="text-white/65 transition hover:text-white">Especialista</Link>
          <Link href="/contact" className="text-white/65 transition hover:text-white">Contato</Link>
          <Link href="/about" className="text-white/65 transition hover:text-white">Sobre</Link>
        </div>
      </div>
      <div className="border-t border-white/10 px-6 py-4 text-center text-xs text-white/45">
        © 2026 Plantasã. Consultoria agrícola com IA e revisão humana especializada.
      </div>
    </footer>
  );
}

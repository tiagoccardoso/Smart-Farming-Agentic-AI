import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-leaf-100 bg-[#0F2F22] text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div>
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sun-100">🌿</span>
            <p className="text-lg font-bold">Plantasã</p>
          </div>
          <p className="mt-3 max-w-xl text-center text-sm leading-6 text-white/75 md:text-left">
            Plantasã • Tecnologia, agronomia e orientação especializada para decisões no campo.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-4 text-sm font-semibold text-white/75 md:justify-end">
          <Link href="/agricultura-organica" className="hover:text-white">Agricultura Orgânica</Link>
          <Link href="/especialista" className="hover:text-white">Especialista</Link>
          <Link href="/contact" className="hover:text-white">Contato</Link>
          <Link href="/about" className="hover:text-white">Sobre</Link>
        </div>
      </div>
      <div className="border-t border-white/10 px-6 py-4 text-center text-xs text-white/55">
        © 2026 Plantasã. Consultoria agrícola com IA e revisão humana especializada.
      </div>
    </footer>
  );
}

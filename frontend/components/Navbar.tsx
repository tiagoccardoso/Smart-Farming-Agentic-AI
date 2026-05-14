import Link from "next/link";

const links = [
  { href: "/", label: "Início" },
  { href: "/crop", label: "Culturas" },
  { href: "/disease", label: "Doenças" },
  { href: "/qa", label: "Perguntas" },
  { href: "/dashboard", label: "Painel" },
  { href: "/models", label: "Modelos" },
  { href: "/about", label: "Sobre" },
  { href: "/contact", label: "Contato" }
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-leaf-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-leaf-800">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-100 text-leaf-700">🌾</span>
          Consultor Agrícola IA
        </Link>
        <nav className="hidden gap-4 text-sm font-medium text-slate-700 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-leaf-700">
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/crop"
          className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
        >
          Testar agora
        </Link>
      </div>
    </header>
  );
}

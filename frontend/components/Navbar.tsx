import Link from "next/link";

type UserRole = "admin" | "especialista" | "doutora" | "produtor";

type NavigationLink = {
  href: string;
  label: string;
  requiresAuth?: boolean;
  allowedRoles?: UserRole[];
};

// TODO: substituir esta sessão temporária pela sessão real do Supabase Auth.
// Exemplo futuro: ler o usuário autenticado, buscar o perfil em `profiles.role`
// e usar esse papel para filtrar os links privados abaixo.
const temporarySession: { isAuthenticated: boolean; role: UserRole } = {
  isAuthenticated: true,
  role: "doutora"
};

const links: NavigationLink[] = [
  { href: "/", label: "Início" },
  { href: "/consultoria-ia", label: "Consultoria IA", requiresAuth: true },
  { href: "/enviar-caso", label: "Enviar Caso", requiresAuth: true },
  { href: "/revisao-humana", label: "Revisão Humana", requiresAuth: true },
  { href: "/meus-relatorios", label: "Meus Relatórios", requiresAuth: true },
  {
    href: "/painel-doutora",
    label: "Painel da Doutora",
    requiresAuth: true,
    allowedRoles: ["admin", "especialista", "doutora"]
  },
  { href: "/planos", label: "Planos" },
  { href: "/crop", label: "Culturas" },
  { href: "/disease", label: "Doenças" },
  { href: "/qa", label: "Perguntas" },
  { href: "/dashboard", label: "Painel" },
  { href: "/models", label: "Modelos" },
  { href: "/about", label: "Sobre" },
  { href: "/contact", label: "Contato" }
];

function canShowLink(link: NavigationLink) {
  if (link.requiresAuth && !temporarySession.isAuthenticated) {
    return false;
  }

  if (link.allowedRoles && !link.allowedRoles.includes(temporarySession.role)) {
    return false;
  }

  return true;
}

export default function Navbar() {
  const visibleLinks = links.filter(canShowLink);

  return (
    <header className="sticky top-0 z-50 border-b border-leaf-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-leaf-800">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-100 text-leaf-700">🌾</span>
          Consultor Agrícola IA
        </Link>
        <nav className="hidden flex-1 flex-wrap justify-center gap-3 text-xs font-medium text-slate-700 md:flex xl:text-sm">
          {visibleLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-leaf-700">
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/consultoria-ia"
          className="self-start rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 lg:self-auto"
        >
          Testar agora
        </Link>
      </div>
    </header>
  );
}

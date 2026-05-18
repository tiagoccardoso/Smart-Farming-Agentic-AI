"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile, UserRole } from "../lib/auth";
import { getCurrentAuthSession, logout } from "../lib/supabaseAuth";

type NavigationLink = {
  href: string;
  label: string;
  requiresAuth?: boolean;
  allowedRoles?: UserRole[];
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
    allowedRoles: ["admin", "specialist"],
  },
  {
    href: "/painel-doutora/usuarios",
    label: "Usuários",
    requiresAuth: true,
    allowedRoles: ["admin", "specialist"],
  },
  {
    href: "/admin/oportunidades",
    label: "Oportunidades",
    requiresAuth: true,
    allowedRoles: ["admin"],
  },
  { href: "/planos", label: "Planos", requiresAuth: true },
  { href: "/crop", label: "Culturas" },
  { href: "/doencas", label: "Doenças" },
  { href: "/qa", label: "Perguntas" },
  { href: "/dashboard", label: "Painel", requiresAuth: true },
  { href: "/models", label: "Modelos" },
  { href: "/about", label: "Sobre" },
  { href: "/contact", label: "Contato" },
];

function canShowLink(link: NavigationLink, profile: Profile | null) {
  if (link.requiresAuth && !profile) {
    return false;
  }

  if (
    link.allowedRoles &&
    !link.allowedRoles.includes(profile?.role as UserRole)
  ) {
    return false;
  }

  return true;
}

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      setLoadingSession(true);
      const session = await getCurrentAuthSession().catch(() => null);

      if (active) {
        setProfile(session?.profile ?? null);
        setLoadingSession(false);
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, [pathname]);

  const visibleLinks = useMemo(
    () => links.filter((link) => canShowLink(link, profile)),
    [profile],
  );

  async function handleLogout() {
    await logout();
    setProfile(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-leaf-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-leaf-800"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-100 text-leaf-700">
            🌾
          </span>
          Consultor Agrícola IA
        </Link>
        <nav className="hidden flex-1 flex-wrap justify-center gap-3 text-xs font-medium text-slate-700 md:flex xl:text-sm">
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-leaf-700"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          {profile ? (
            <>
              <span className="rounded-full bg-leaf-50 px-3 py-2 text-xs font-semibold text-leaf-800">
                {profile.full_name || "Conta"} · {profile.role}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
              >
                Sair
              </button>
            </>
          ) : (
            !loadingSession && (
              <Link
                href="/login"
                className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
              >
                Entrar
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}

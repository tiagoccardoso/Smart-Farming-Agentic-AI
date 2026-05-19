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

const publicLinks: NavigationLink[] = [
  { href: "/", label: "Início" },
  { href: "/culturas", label: "Culturas" },
  { href: "/doencas", label: "Doenças" },
  { href: "/qa", label: "Perguntas" },
  { href: "/especialista", label: "Especialista" },
  { href: "/agricultura-organica", label: "Agricultura Orgânica" },
  { href: "/contact", label: "Contato" },
  { href: "/about", label: "Sobre" },
];

const accountLinks: NavigationLink[] = [
  { href: "/perfil", label: "Perfil", requiresAuth: true },
  { href: "/consultoria-ia", label: "Consultoria IA", requiresAuth: true },
  { href: "/enviar-caso", label: "Enviar Caso", requiresAuth: true },
  { href: "/revisao-humana", label: "Revisão Humana", requiresAuth: true },
  { href: "/meus-relatorios", label: "Meus Relatórios", requiresAuth: true },
  { href: "/dashboard", label: "Painel", requiresAuth: true },
  { href: "/planos", label: "Planos", requiresAuth: true },
  {
    href: "/admin/agendamentos",
    label: "Agendamentos",
    requiresAuth: true,
    allowedRoles: ["admin", "specialist"],
  },
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
];

function canShowLink(link: NavigationLink, profile: Profile | null) {
  if (link.requiresAuth && !profile) return false;
  if (link.allowedRoles && !link.allowedRoles.includes(profile?.role as UserRole)) return false;
  return true;
}

function NavLink({ link, pathname, onClick }: { link: NavigationLink; pathname: string; onClick?: () => void }) {
  const active = pathname === link.href;
  return (
    <Link
      href={link.href}
      onClick={onClick}
      className={`rounded-full px-3 py-2 transition ${
        active ? "bg-leaf-50 text-leaf-800" : "hover:bg-leaf-50 hover:text-leaf-700"
      }`}
    >
      {link.label}
    </Link>
  );
}

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const visibleAccountLinks = useMemo(() => accountLinks.filter((link) => canShowLink(link, profile)), [profile]);

  async function handleLogout() {
    await logout();
    setProfile(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-leaf-100 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-6">
        <Link href="/" className="flex items-center gap-3 font-semibold text-leaf-900">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-leaf-100 to-sun-100 text-leaf-800 shadow-soft">🌿</span>
          <span className="text-lg tracking-tight">Plantasã</span>
        </Link>

        <nav className="hidden flex-1 flex-wrap justify-center gap-1 text-xs font-semibold text-slate-700 lg:flex xl:text-sm">
          {publicLinks.map((link) => (
            <NavLink key={link.href} link={link} pathname={pathname} />
          ))}
          {visibleAccountLinks.length > 0 && <span className="mx-1 h-8 w-px bg-leaf-100" aria-hidden="true" />}
          {visibleAccountLinks.map((link) => (
            <NavLink key={link.href} link={link} pathname={pathname} />
          ))}
        </nav>

        <div className="hidden flex-wrap items-center gap-3 lg:flex">
          {profile ? (
            <>
              <span className="rounded-full bg-leaf-50 px-3 py-2 text-xs font-semibold text-leaf-800">
                {profile.full_name || "Conta"} · {profile.role}
              </span>
              <button type="button" onClick={handleLogout} className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50">
                Sair
              </button>
            </>
          ) : (
            !loadingSession && (
              <Link href="/login" className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50">
                Entrar
              </Link>
            )
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-leaf-100 text-leaf-800 lg:hidden"
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-leaf-100 bg-white px-5 py-4 lg:hidden">
          <nav className="grid gap-2 text-sm font-semibold text-slate-700">
            {publicLinks.map((link) => (
              <NavLink key={link.href} link={link} pathname={pathname} onClick={() => setMobileOpen(false)} />
            ))}
            {visibleAccountLinks.length > 0 && <div className="my-2 h-px bg-leaf-100" />}
            {visibleAccountLinks.map((link) => (
              <NavLink key={link.href} link={link} pathname={pathname} onClick={() => setMobileOpen(false)} />
            ))}
          </nav>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {profile ? (
              <>
                <span className="rounded-full bg-leaf-50 px-3 py-2 text-xs font-semibold text-leaf-800">
                  {profile.full_name || "Conta"} · {profile.role}
                </span>
                <button type="button" onClick={handleLogout} className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50">
                  Sair
                </button>
              </>
            ) : (
              !loadingSession && (
                <Link href="/login" className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50">
                  Entrar
                </Link>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
}

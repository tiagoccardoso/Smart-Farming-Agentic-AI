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
  children?: NavigationLink[];
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
  { href: "/consultoria-ia", label: "Consultoria IA", requiresAuth: true },
  { href: "/enviar-caso", label: "Enviar Caso", requiresAuth: true },
  { href: "/revisao-humana", label: "Revisão Humana", requiresAuth: true },
  { href: "/meus-relatorios", label: "Meus Relatórios", requiresAuth: true },
  { href: "/dashboard", label: "Painel", requiresAuth: true },
  { href: "/acompanhamento", label: "Acompanhamento", requiresAuth: true, allowedRoles: ["admin", "specialist"] },
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
    href: "/configuracoes",
    label: "Configurações",
    requiresAuth: true,
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
      className={`block rounded-full px-3 py-2 transition ${
        active ? "bg-leaf-100 text-moss-800" : "hover:bg-leaf-50 hover:text-leaf-700"
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
    function handleAuthChanged() {
      void loadSession();
    }
    void loadSession();
    window.addEventListener("auth:changed", handleAuthChanged);
    return () => {
      active = false;
      window.removeEventListener("auth:changed", handleAuthChanged);
    };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const visibleAccountLinks = useMemo(() => {
    return accountLinks
      .filter((link) => canShowLink(link, profile))
      .map((link) => {
        if (!link.children) return link;
        return {
          ...link,
          children: link.children.filter((child) => canShowLink(child, profile)),
        };
      });
  }, [profile]);

  async function handleLogout() {
    await logout();
    setProfile(null);
    window.dispatchEvent(new Event("auth:changed"));
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-paper-200 bg-paper-100/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:py-4 lg:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3 font-semibold text-moss-900">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-leaf-100 to-gold-100 text-moss-800 shadow-soft">🌿</span>
          <span className="truncate text-lg tracking-tight">Plantasã</span>
        </Link>

        <nav className="hidden flex-1 flex-wrap justify-center gap-1 text-xs font-semibold text-slate-700 lg:flex xl:text-sm">
          {publicLinks.map((link) => (
            <NavLink key={link.href} link={link} pathname={pathname} />
          ))}
          {visibleAccountLinks.length > 0 && <span className="mx-1 h-8 w-px bg-leaf-100" aria-hidden="true" />}
          {visibleAccountLinks.map((link) => (
            <div key={link.href} className="group relative">
              <NavLink link={link} pathname={pathname} />
              {link.children && link.children.length > 0 && (
                <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-44 rounded-2xl border border-leaf-100 bg-white p-2 opacity-0 shadow-soft transition group-hover:visible group-hover:opacity-100">
                  {link.children.map((child) => (
                    <NavLink key={child.href} link={child} pathname={pathname} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="hidden flex-wrap items-center gap-3 lg:flex">
          {profile ? (
            <>
              <span className="rounded-full bg-leaf-50 px-3 py-2 text-xs font-semibold text-leaf-800">
                {profile.full_name || "Conta"} · {profile.role}
              </span>
              <button type="button" onClick={handleLogout} className="rounded-full border border-leaf-200 bg-white/70 px-4 py-2 text-center text-sm font-semibold text-leaf-800 transition hover:bg-leaf-50">
                Sair
              </button>
            </>
          ) : (
            !loadingSession && (
              <Link href="/login" className="rounded-full border border-leaf-200 bg-white/70 px-4 py-2 text-center text-sm font-semibold text-leaf-800 transition hover:bg-leaf-50">
                Entrar
              </Link>
            )
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-paper-200 bg-white/80 text-leaf-800 lg:hidden"
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileOpen && (
        <div className="max-h-[calc(100vh-4.25rem)] overflow-y-auto border-t border-paper-200 bg-paper-100 px-4 py-4 shadow-soft lg:hidden">
          <nav className="grid gap-2 text-sm font-semibold text-slate-700">
            {publicLinks.map((link) => (
              <NavLink key={link.href} link={link} pathname={pathname} onClick={() => setMobileOpen(false)} />
            ))}
            {visibleAccountLinks.length > 0 && <div className="my-2 h-px bg-leaf-100" />}
            {visibleAccountLinks.map((link) => (
              <div key={link.href} className="grid gap-2">
                <NavLink link={link} pathname={pathname} onClick={() => setMobileOpen(false)} />
                {link.children?.length ? (
                  <div className="ml-4 grid gap-1 border-l border-leaf-100 pl-2">
                    {link.children.map((child) => (
                      <NavLink key={child.href} link={child} pathname={pathname} onClick={() => setMobileOpen(false)} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
          <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
            {profile ? (
              <>
                <span className="rounded-full bg-leaf-50 px-3 py-2 text-xs font-semibold text-leaf-800">
                  {profile.full_name || "Conta"} · {profile.role}
                </span>
                <button type="button" onClick={handleLogout} className="rounded-full border border-leaf-200 bg-white/70 px-4 py-2 text-center text-sm font-semibold text-leaf-800 transition hover:bg-leaf-50">
                  Sair
                </button>
              </>
            ) : (
              !loadingSession && (
                <Link href="/login" className="rounded-full border border-leaf-200 bg-white/70 px-4 py-2 text-center text-sm font-semibold text-leaf-800 transition hover:bg-leaf-50">
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

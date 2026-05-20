"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import type { UserRole } from "../../lib/auth";
import { getCurrentAuthSession } from "../../lib/supabaseAuth";

const configLinks: { href: string; label: string; icon: string; allowedRoles?: UserRole[] }[] = [
  { href: "/perfil", label: "Perfil", icon: "👤" },
  { href: "/painel-doutora/usuarios", label: "Usuários", icon: "👥", allowedRoles: ["admin", "specialist"] },
  { href: "/painel-doutora/culturas", label: "Culturas", icon: "🌱", allowedRoles: ["admin", "specialist"] },
  { href: "/painel-doutora/site-pages/especialista", label: "Editar página da especialista", icon: "🧑‍⚕️", allowedRoles: ["admin", "specialist"] },
  { href: "/painel-doutora/site-pages/home", label: "Editar página inicial", icon: "🏠", allowedRoles: ["admin", "specialist"] },
  { href: "/painel-doutora/site-pages/agricultura-organica", label: "Editar página Agricultura Orgânica", icon: "🌿", allowedRoles: ["admin", "specialist"] },
  { href: "/painel-doutora?tab=knowledge", label: "Base de conhecimento", icon: "📚", allowedRoles: ["admin", "specialist"] },
];

export default function ConfiguracoesPage() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const session = await getCurrentAuthSession().catch(() => null);
      setRole((session?.profile?.role as UserRole | undefined) ?? null);
      setLoading(false);
    })();
  }, []);

  const visibleLinks = configLinks.filter((item) => !item.allowedRoles || (role ? item.allowedRoles.includes(role) : false));

  if (!loading && visibleLinks.length === 0) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft">
          <h2 className="text-lg font-semibold">Acesso negado</h2>
          <p className="mt-2 text-sm leading-6">Você não possui permissões para acessar os itens de configurações disponíveis.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-6 py-14 md:py-20">
      <p className="mb-4 inline-flex rounded-full bg-leaf-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">⚙️ Área administrativa</p>
      <SectionTitle
        title="Configurações"
        subtitle="Gerencie usuários, culturas e conteúdo institucional da área pública."
      />

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {visibleLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft transition hover:-translate-y-1 hover:border-leaf-300"
          >
            <p className="text-2xl">{item.icon}</p>
            <p className="mt-2 text-base font-semibold text-[#123F2A]">{item.label}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

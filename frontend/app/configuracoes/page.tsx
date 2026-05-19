"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import { getCurrentAuthSession } from "../../lib/supabaseAuth";

const configLinks = [
  { href: "/painel-doutora/usuarios", label: "Usuários", icon: "👥" },
  { href: "/painel-doutora/culturas", label: "Culturas", icon: "🌱" },
  { href: "/painel-doutora/site-pages/especialista", label: "Editar página da especialista", icon: "🧑‍⚕️" },
  { href: "/painel-doutora/site-pages/home", label: "Editar página inicial", icon: "🏠" },
  { href: "/painel-doutora/site-pages/agricultura-organica", label: "Editar página Agricultura Orgânica", icon: "🌿" },
];

export default function ConfiguracoesPage() {
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getCurrentAuthSession().catch(() => null);
      const role = session?.profile?.role;
      setAccessDenied(!(role === "admin" || role === "specialist"));
    })();
  }, []);

  if (accessDenied) {
    return (
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-soft">
          <h2 className="text-lg font-semibold">Acesso negado</h2>
          <p className="mt-2 text-sm leading-6">Apenas usuários com role specialist ou admin podem acessar as configurações.</p>
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
        {configLinks.map((item) => (
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

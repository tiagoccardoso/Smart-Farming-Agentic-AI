"use client";

import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../../lib/auth";
import { getCurrentAuthSession } from "../../../lib/supabaseAuth";
import { acompanhamentoModules } from "../modules";

export default function AcompanhamentoModuloPage() {
  const params = useParams<{ modulo: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const moduleData = useMemo(() => acompanhamentoModules.find((item) => item.slug === params.modulo), [params.modulo]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await getCurrentAuthSession();
        if (!session?.access_token) {
          router.push("/login");
          return;
        }
        if (active) setProfile(session.profile ?? null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  if (!moduleData) return notFound();

  const hasAccess = ["admin", "specialist"].includes(profile?.role ?? "");
  if (loading) return <div className="mx-auto max-w-6xl px-6 py-12"><p className="animate-pulse rounded-2xl border border-leaf-100 bg-white p-4 text-sm text-slate-500">Carregando estrutura do módulo...</p></div>;
  if (!hasAccess) return <div className="mx-auto max-w-6xl px-6 py-12"><div className="rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">Acesso restrito a administradores e especialistas.</div></div>;

  return <section className="mx-auto max-w-6xl px-6 py-12">
    <Link href="/acompanhamento" className="text-sm font-semibold text-leaf-700">← Voltar para dashboard de acompanhamento</Link>
    <div className="mt-5 rounded-3xl border border-leaf-100 bg-white p-7 shadow-soft">
      <p className="text-4xl" aria-hidden="true">{moduleData.icon}</p>
      <h1 className="mt-3 text-3xl font-bold text-[#123F2A]">{moduleData.title}</h1>
      <p className="mt-3 text-slate-600">{moduleData.description}</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <article className="rounded-2xl border border-leaf-100 bg-leaf-50/40 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-leaf-700">Campos/itens estruturados</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {moduleData.fields.map((field) => <li key={field} className="flex items-start gap-2"><span aria-hidden="true">•</span><span>{field}</span></li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-leaf-100 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-leaf-700">Preparação para evolução</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {(moduleData.highlights ?? ["Estrutura pronta para histórico por usuário/propriedade", "Base compatível com operação mobile no campo", "Modelo escalável para sincronização/offline futura"]).map((item) => (
              <li key={item} className="flex items-start gap-2"><span aria-hidden="true">✓</span><span>{item}</span></li>
            ))}
          </ul>
        </article>
      </div>
      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Protótipo estrutural: sem integrações pesadas nesta versão inicial, preservando desempenho e os fluxos já existentes.</div>
    </div>
  </section>;
}

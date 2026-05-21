"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../lib/auth";
import { getCurrentAuthSession } from "../../lib/supabaseAuth";
import { acompanhamentoModules } from "./modules";

export default function AcompanhamentoPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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

  const hasAccess = useMemo(() => ["admin", "specialist"].includes(profile?.role ?? ""), [profile?.role]);

  if (loading) return <div className="mx-auto max-w-7xl px-6 py-12"><p className="animate-pulse rounded-2xl border border-leaf-100 bg-white p-4 text-sm text-slate-500">Carregando módulo de acompanhamento...</p></div>;
  if (!hasAccess) return <div className="mx-auto max-w-7xl px-6 py-12"><div className="rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">Acesso restrito a administradores e especialistas.</div></div>;

  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      <p className="inline-flex rounded-full bg-leaf-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">🌱 Hub técnico agronômico</p>
      <h1 className="mt-4 text-4xl font-bold text-[#123F2A]">Acompanhamento</h1>
      <p className="mt-3 max-w-4xl text-slate-600">Acesse rapidamente os módulos da rotina de assistência técnica com foco em velocidade de uso no campo, histórico visual simples e base pronta para evolução offline/sincronização.</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {acompanhamentoModules.map((module) => (
          <article key={module.slug} className="group rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-leaf-50 text-2xl" aria-hidden="true">{module.icon}</span>
              <span className="rounded-full border border-leaf-100 px-3 py-1 text-xs font-semibold text-leaf-700">Módulo</span>
            </div>
            <h2 className="mt-4 text-xl font-bold text-[#123F2A]">{module.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
            <Link href={`/acompanhamento/${module.slug}`} className="mt-5 inline-flex rounded-full bg-[#2E7D32] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#25672A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E7D32]" aria-label={`Abrir módulo ${module.title}`}>
              Acessar módulo
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

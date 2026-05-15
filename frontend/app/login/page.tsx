"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import { loginWithEmailPassword } from "../../lib/supabaseAuth";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/consultoria-ia";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await loginWithEmailPassword(email, password);
      router.push(nextPath);
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Área segura
        </p>
        <SectionTitle title="Entrar" subtitle="Acesse sua consultoria agrícola com e-mail e senha." />
        <p className="text-base leading-7 text-slate-700">
          Faça login para enviar casos, acompanhar relatórios, solicitar revisão humana e consultar a IA usando seus dados protegidos pelo Supabase Auth.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
        <div className="space-y-5">
          <InputField label="E-mail" name="email" type="email" value={email} onChange={(value) => setEmail(value)} required />
          <InputField label="Senha" name="password" type="password" value={password} onChange={(value) => setPassword(value)} required />
        </div>

        {error && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="mt-5 text-center text-sm text-slate-600">
          Ainda não tem conta?{" "}
          <Link href="/register" className="font-semibold text-leaf-700 hover:text-leaf-800">
            Criar cadastro
          </Link>
        </p>
      </form>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">Carregando login...</div>}>
      <LoginContent />
    </Suspense>
  );
}

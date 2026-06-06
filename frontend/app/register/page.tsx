"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import { registerWithEmailPassword } from "../../lib/supabaseAuth";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const trimmedFullName = fullName.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedFullName) {
      setError("Informe seu nome completo.");
      setLoading(false);
      return;
    }

    if (!trimmedPhone) {
      setError("Informe seu telefone.");
      setLoading(false);
      return;
    }

    try {
      const payload = await registerWithEmailPassword({ fullName: trimmedFullName, email, phone: trimmedPhone, password });

      if (payload.needsEmailConfirmation) {
        setMessage(payload.message ?? "Cadastro criado. Confirme seu e-mail antes de fazer login.");
        return;
      }

      router.push("/consultoria-ia");
      router.refresh();
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Não foi possível criar sua conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 sm:py-14 md:py-20 xl:grid-cols-[0.95fr_1.05fr] xl:items-center">
      <div className="rounded-3xl bg-hero-gradient p-5 shadow-soft sm:p-6 md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Novo produtor
        </p>
        <SectionTitle title="Criar conta" subtitle="Cadastre-se para salvar casos e relatórios agrícolas." />
        <p className="text-base leading-7 text-slate-700">
          O cadastro cria automaticamente seu perfil com papel de cliente. Especialistas e administradores devem ter o papel ajustado no Supabase por um admin.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6 md:p-8">
        <div className="space-y-5">
          <InputField label="Nome completo" name="fullName" type="text" value={fullName} onChange={(value) => setFullName(value)} required />
          <InputField label="E-mail" name="email" type="email" value={email} onChange={(value) => setEmail(value)} required />
          <InputField label="Telefone" name="phone" type="tel" value={phone} onChange={(value) => setPhone(value)} required />
          <InputField label="Senha" name="password" type="password" value={password} onChange={(value) => setPassword(value)} required />
        </div>

        {error && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {message && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Criando conta..." : "Criar conta"}
        </button>

        <p className="mt-5 text-center text-sm text-slate-600">
          Já tem conta?{" "}
          <Link href="/login" className="font-semibold text-leaf-700 hover:text-leaf-800">
            Entrar
          </Link>
        </p>
      </form>
    </section>
  );
}

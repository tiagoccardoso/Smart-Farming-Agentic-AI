"use client";

import { FormEvent, useEffect, useState } from "react";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import {
  getCurrentAuthSession,
  updateCurrentAuthCredentials,
  updateCurrentProfile,
} from "../../lib/supabaseAuth";

export default function PerfilPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      setLoading(true);
      setError(null);
      try {
        const session = await getCurrentAuthSession();

        if (!session) {
          setError("Sessão inválida. Faça login novamente.");
          return;
        }

        setFullName(session.profile?.full_name ?? "");
        setPhone(session.profile?.phone ?? "");
        setEmail(session.user?.email ?? "");
        setNewEmail(session.user?.email ?? "");
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : "Não foi possível carregar o perfil.");
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, []);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = await updateCurrentProfile({ fullName, phone });
      setFullName(payload.profile?.full_name ?? fullName);
      setPhone(payload.profile?.phone ?? phone);
      setSuccess(payload.message ?? "Perfil atualizado com sucesso.");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Não foi possível atualizar o perfil.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCredentialsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCredentials(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = await updateCurrentAuthCredentials({
        email: newEmail !== email ? newEmail : undefined,
        password: newPassword || undefined,
      });
      setSuccess(
        payload.message ??
          "Solicitação processada. Alterações de e-mail podem exigir confirmação no e-mail informado.",
      );
      if (newEmail !== email) {
        setEmail(newEmail);
      }
      setNewPassword("");
    } catch (credentialsError) {
      setError(credentialsError instanceof Error ? credentialsError.message : "Não foi possível atualizar as credenciais.");
    } finally {
      setSavingCredentials(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-6 py-16 text-sm text-[#414943]">Carregando perfil...</div>;
  }

  return (
    <section className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-8">
        <SectionTitle title="Perfil" subtitle="Gerencie seus dados cadastrais e credenciais com segurança." />
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-2xl border border-leaf-200 bg-leaf-50 p-4 text-sm text-leaf-800">{success}</div>}

      <form onSubmit={handleProfileSubmit} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
        <h2 className="mb-4 text-base font-semibold text-[#1d1c16]">Dados cadastrais</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="Nome completo" name="full_name" type="text" value={fullName} onChange={setFullName} required />
          <InputField label="Telefone" name="phone" type="tel" value={phone} onChange={setPhone} required />
        </div>
        <button type="submit" disabled={savingProfile} className="mt-6 rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-60">
          {savingProfile ? "Salvando..." : "Salvar perfil"}
        </button>
      </form>

      <form onSubmit={handleCredentialsSubmit} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
        <h2 className="mb-4 text-base font-semibold text-[#1d1c16]">Acesso da conta</h2>
        <p className="mb-4 text-sm text-[#414943]">E-mail atual: {email || "não informado"}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <InputField label="Novo e-mail" name="email" type="email" value={newEmail} onChange={setNewEmail} />
          <InputField label="Nova senha" name="password" type="password" value={newPassword} onChange={setNewPassword} />
        </div>
        <p className="mt-4 text-xs text-[#717973]">
          Alterações de e-mail podem exigir confirmação por link enviado para sua caixa de entrada.
        </p>
        <button type="submit" disabled={savingCredentials} className="mt-6 rounded-full border border-leaf-200 px-5 py-3 text-sm font-semibold text-leaf-700 hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60">
          {savingCredentials ? "Atualizando..." : "Atualizar acesso"}
        </button>
      </form>
    </section>
  );
}

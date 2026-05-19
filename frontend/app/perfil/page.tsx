"use client";
import { FormEvent, useEffect, useState } from "react";
import { getCurrentAuthSession } from "../../lib/supabaseAuth";

export default function PerfilPage() {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", city: "", state: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    getCurrentAuthSession().then((session) => {
      setForm({ fullName: session?.profile?.full_name ?? "", email: session?.user?.email ?? "", phone: session?.profile?.phone ?? "", city: session?.profile?.city ?? "", state: session?.profile?.state ?? "", newPassword: "", confirmPassword: "" });
      setLoading(false);
    }).catch(() => { setError("Não foi possível carregar seu perfil."); setLoading(false); });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/auth/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Erro ao salvar");
      setSuccess(payload.emailUpdateRequested ? "Solicitação de alteração de e-mail enviada. Verifique o novo endereço para confirmar a alteração." : payload.passwordUpdated ? "Senha atualizada com sucesso." : "Perfil atualizado com sucesso.");
      setForm((prev) => ({ ...prev, newPassword: "", confirmPassword: "" }));
      await getCurrentAuthSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar perfil.");
    } finally { setSaving(false); }
  }

  if (loading) return <section className="mx-auto max-w-4xl px-6 py-12">Carregando dados...</section>;

  return <section className="mx-auto max-w-4xl px-6 py-12"><h1 className="text-3xl font-semibold text-leaf-900">Meu perfil</h1><p className="mt-2 text-slate-600">Atualize seus dados de acesso e informações pessoais.</p>
  <form onSubmit={onSubmit} className="mt-6 space-y-6 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
    <div><h2 className="text-lg font-semibold">Dados pessoais</h2><div className="mt-3 grid gap-3 md:grid-cols-2"><input value={form.fullName} onChange={(e)=>setForm({...form,fullName:e.target.value})} placeholder="Nome" className="rounded-xl border border-leaf-100 px-4 py-2" /><input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})} placeholder="Telefone" className="rounded-xl border border-leaf-100 px-4 py-2" /><input value={form.city} onChange={(e)=>setForm({...form,city:e.target.value})} placeholder="Cidade" className="rounded-xl border border-leaf-100 px-4 py-2" /><input value={form.state} onChange={(e)=>setForm({...form,state:e.target.value})} placeholder="Estado" className="rounded-xl border border-leaf-100 px-4 py-2" /></div></div>
    <div><h2 className="text-lg font-semibold">Dados de acesso</h2><input type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} className="mt-3 w-full rounded-xl border border-leaf-100 px-4 py-2" /></div>
    <div><h2 className="text-lg font-semibold">Alteração de senha</h2><div className="mt-3 grid gap-3 md:grid-cols-2"><input type="password" value={form.newPassword} onChange={(e)=>setForm({...form,newPassword:e.target.value})} placeholder="Nova senha" className="rounded-xl border border-leaf-100 px-4 py-2" /><input type="password" value={form.confirmPassword} onChange={(e)=>setForm({...form,confirmPassword:e.target.value})} placeholder="Confirmar nova senha" className="rounded-xl border border-leaf-100 px-4 py-2" /></div></div>
    {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}
    <button disabled={saving} className="rounded-full bg-leaf-600 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Salvando..." : "Salvar alterações"}</button>
  </form></section>;
}

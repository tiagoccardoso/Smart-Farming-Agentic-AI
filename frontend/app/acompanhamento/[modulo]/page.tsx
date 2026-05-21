"use client";

import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../../lib/auth";
import { getCurrentAuthSession, getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import { acompanhamentoModules } from "../modules";

type RecordItem = { id: string; title: string; status?: string | null; record_date?: string | null; amount?: number | null; data?: Record<string, string>; created_at?: string };

export default function AcompanhamentoModuloPage() {
  const params = useParams<{ modulo: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", title: "", status: "ativo", record_date: "", amount: "", notes: "" });

  const moduleData = useMemo(() => acompanhamentoModules.find((item) => item.slug === params.modulo), [params.modulo]);
  const hasAccess = ["admin", "specialist"].includes(profile?.role ?? "");

  async function loadRecords() {
    const token = getStoredSupabaseAccessToken();
    if (!token || !moduleData) return;
    const response = await fetch(`/api/acompanhamento/${moduleData.slug}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (response.ok) setRecords(payload.records ?? []);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await getCurrentAuthSession();
        if (!session?.access_token) return router.push("/login");
        if (active) setProfile(session.profile ?? null);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => { if (hasAccess) loadRecords(); }, [hasAccess, moduleData?.slug]);

  if (!moduleData) return notFound();
  if (loading) return <div className="mx-auto max-w-6xl px-6 py-12"><p className="animate-pulse rounded-2xl border border-leaf-100 bg-white p-4 text-sm text-slate-500">Carregando...</p></div>;
  if (!hasAccess) return <div className="mx-auto max-w-6xl px-6 py-12"><div className="rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">Acesso restrito a administradores e especialistas.</div></div>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return setMessage("Título obrigatório.");
    setSaving(true); setMessage(null);
    const token = getStoredSupabaseAccessToken();
    const body = { title: form.title, status: form.status || null, record_date: form.record_date || null, amount: form.amount ? Number(form.amount.replace(".", "").replace(",", ".")) : null, data: { notes: form.notes } };
    const url = form.id ? `/api/acompanhamento/${moduleData.slug}/${form.id}` : `/api/acompanhamento/${moduleData.slug}`;
    const method = form.id ? "PUT" : "POST";
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(payload.error || "Erro ao salvar.");
    setForm({ id: "", title: "", status: "ativo", record_date: "", amount: "", notes: "" });
    setMessage("Registro salvo com sucesso.");
    loadRecords();
  };

  return <section className="mx-auto max-w-6xl px-6 py-12">
    <Link href="/acompanhamento" className="text-sm font-semibold text-leaf-700">← Voltar</Link>
    <h1 className="mt-3 text-3xl font-bold text-[#123F2A]">{moduleData.title}</h1>
    <p className="mt-2 text-slate-600">{moduleData.description}</p>
    {message ? <p className="mt-3 rounded-xl border border-leaf-100 bg-leaf-50 p-3 text-sm">{message}</p> : null}
    <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-leaf-100 bg-white p-4 md:grid-cols-2">
      <input className="rounded-xl border p-2" placeholder="Título do registro" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <input className="rounded-xl border p-2" type="date" value={form.record_date} onChange={(e) => setForm((f) => ({ ...f, record_date: e.target.value }))} />
      <input className="rounded-xl border p-2" placeholder="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} />
      <input className="rounded-xl border p-2" placeholder="Valor (R$ 1.234,56)" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
      <textarea className="rounded-xl border p-2 md:col-span-2" placeholder="Observações" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      <div className="md:col-span-2 flex gap-2"><button className="rounded-xl bg-leaf-600 px-4 py-2 text-white" disabled={saving}>{saving ? "Salvando..." : form.id ? "Atualizar" : "Novo cadastro"}</button>{form.id ? <button type="button" className="rounded-xl border px-4 py-2" onClick={() => setForm({ id: "", title: "", status: "ativo", record_date: "", amount: "", notes: "" })}>Cancelar edição</button> : null}</div>
    </form>
    <div className="mt-6 space-y-3">{records.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Nenhum registro cadastrado.</p> : records.map((item) => <article key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{item.title}</h2><div className="flex gap-2"><button className="text-sm text-blue-700" onClick={() => setForm({ id: item.id, title: item.title ?? "", status: item.status ?? "", record_date: item.record_date ?? "", amount: item.amount ? item.amount.toString().replace(".", ",") : "", notes: String(item.data?.notes ?? "") })}>Editar</button><button className="text-sm text-red-700" onClick={async () => { if (!confirm("Deseja excluir este registro?")) return; const token = getStoredSupabaseAccessToken(); const r = await fetch(`/api/acompanhamento/${moduleData.slug}/${item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (r.ok) { setMessage("Registro excluído com sucesso."); loadRecords(); } }}>Excluir</button></div></div></article>)}</div>
  </section>;
}

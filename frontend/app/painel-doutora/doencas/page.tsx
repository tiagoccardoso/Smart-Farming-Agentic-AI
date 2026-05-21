"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type Disease = { id: string; common_name: string; scientific_name?: string | null; disease_type?: string | null; symptoms?: string | null; severity_level?: string | null; management_recommendations?: string | null; crop_id?: string | null; is_active: boolean };
const empty = { common_name: "", scientific_name: "", disease_type: "", symptoms: "", severity_level: "", management_recommendations: "", crop_id: "", is_active: true, id: "" };

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [q, setQ] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = () => getStoredSupabaseAccessToken();

  async function load() { const t = token(); if (!t) return; const r = await fetch('/api/specialist/diseases', { headers: { Authorization: `Bearer ${t}` } }); const p = await r.json(); if (r.ok) setItems(p.diseases ?? []); else setErr(p.error || 'Erro'); }
  useEffect(() => { load(); }, []);

  async function fillWithAI() {
    const t = token(); if (!t) return;
    if (!aiName.trim()) { setErr("Informe o nome da doença para preenchimento com IA."); return; }
    setAiLoading(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/specialist/ai-fill', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ type: 'disease', name: aiName.trim() }) });
      const p = await r.json();
      if (!r.ok) { setErr(p.error || 'Erro ao gerar sugestão por IA.'); return; }
      setForm((c: any) => ({ ...c, ...p.suggestion, id: c.id }));
      setMsg("Sugestão da IA aplicada. Revise os dados antes de salvar.");
    } finally { setAiLoading(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token(); if (!t) return;
    if (!form.common_name?.trim()) { setErr("Nome comum obrigatório."); return; }
    const method = form.id ? 'PATCH' : 'POST';
    const payload = { ...form, crop_id: form.crop_id?.trim() ? form.crop_id.trim() : null };
    const r = await fetch('/api/specialist/diseases', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
    const p = await r.json();
    if (!r.ok) { setErr(p.error || 'Erro'); return; }
    setMsg('Doença salva com sucesso.'); setErr(null); setForm(empty); load();
  }

  const visible = items.filter((x) => `${x.common_name} ${x.scientific_name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return <section className="mx-auto max-w-7xl px-6 py-12"><Link href="/configuracoes">← Configurações</Link><SectionTitle title="Cadastro de Doenças" subtitle="Gestão técnica de doenças para monitoramento fitossanitário." />{err && <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-red-700">{err}</p>}{msg && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{msg}</p>}<div className="mb-4 mt-4 rounded-2xl border border-leaf-100 bg-leaf-50 p-4"><p className="text-sm font-semibold text-leaf-800">Preenchimento assistido por IA</p><div className="mt-2 flex flex-col gap-2 md:flex-row"><input className="w-full rounded-2xl border border-leaf-100 bg-white p-3 text-sm" placeholder="Digite o nome da doença" value={aiName} onChange={e => setAiName(e.target.value)} /><button type="button" onClick={fillWithAI} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300">{aiLoading ? 'Gerando...' : 'Preencher com IA'}</button></div></div><form onSubmit={submit} className="grid gap-3 md:grid-cols-2">{Object.entries({ common_name: 'Nome comum *', scientific_name: 'Nome científico', disease_type: 'Tipo', symptoms: 'Sintomas principais', severity_level: 'Nível de severidade', management_recommendations: 'Manejo', crop_id: 'ID da cultura (UUID, opcional)' }).map(([k, l]) => <label key={k}>{l}<textarea required={k === 'common_name'} className="w-full rounded border border-leaf-100 p-2" value={form[k] ?? ''} onChange={e => setForm((c: any) => ({ ...c, [k]: e.target.value }))} /></label>)}<label className="md:col-span-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm((c: any) => ({ ...c, is_active: e.target.checked }))} /> Ativa</label><button className="rounded bg-green-700 p-2 text-white">Salvar</button></form><input className="mt-4 w-full rounded border border-leaf-100 p-2" placeholder="Buscar doença" value={q} onChange={e => setQ(e.target.value)} /><div className="mt-4 space-y-2">{visible.length === 0 ? <p>Nenhuma doença cadastrada.</p> : visible.map(d => <article key={d.id} className="rounded border p-3"><strong>{d.common_name}</strong><p>{d.scientific_name}</p><p className="text-xs text-slate-500">Cultura vinculada: {d.crop_id || 'não vinculada'}</p><div className="flex gap-3"><button onClick={() => setForm(d)}>Editar</button><button onClick={async () => { const t = token(); if (!t) return; await fetch(`/api/specialist/diseases?id=${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }); load(); }}>Excluir</button></div></article>)}</div></section>;
}

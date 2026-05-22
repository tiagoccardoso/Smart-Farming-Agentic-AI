"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type CropOption = { id: string; display_name_pt: string | null; name: string };
type Disease = { id: string; common_name: string; scientific_name?: string | null; causal_agent?: string | null; disease_type?: string | null; symptoms?: string | null; favorable_conditions?: string | null; crop_stage?: string | null; severity_level?: string | null; management_recommendations?: string | null; preventive_control?: string | null; curative_control?: string | null; technical_notes?: string | null; crop_id?: string | null; is_active: boolean; };

const empty: Disease = { id: "", common_name: "", scientific_name: "", causal_agent: "", disease_type: "", symptoms: "", favorable_conditions: "", crop_stage: "", severity_level: "", management_recommendations: "", preventive_control: "", curative_control: "", technical_notes: "", crop_id: "", is_active: true };

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const token = () => getStoredSupabaseAccessToken();

  const loadData = useCallback(async () => {
    const t = token();
    if (!t) return;
    setLoadingData(true);
    try {
      const [d, c] = await Promise.all([fetch("/api/specialist/diseases", { headers: { Authorization: `Bearer ${t}` } }), fetch("/api/specialist/crops", { headers: { Authorization: `Bearer ${t}` } })]);
      const dp = await d.json();
      const cp = await c.json();
      if (d.ok) setItems(dp.diseases ?? []);
      if (c.ok) setCrops(cp.crops ?? []);
    } finally { setLoadingData(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving) return;
    setSaving(true); setErr(null); setMsg(null);
    try {
      const payload = { ...form, crop_id: form.crop_id?.trim() ? form.crop_id : null };
      const r = await fetch("/api/specialist/diseases", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
      const p = await r.json(); if (!r.ok) throw new Error(p?.error || "Falha ao salvar");
      setMsg(form.id ? "Doença atualizada com sucesso." : "Doença salva com sucesso.");
      setForm(empty);
      await loadData();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar"); } finally { setSaving(false); }
  }

  const fields: Array<[keyof Disease, string]> = [["common_name", "Nome comum *"], ["scientific_name", "Nome científico *"], ["causal_agent", "Agente causal *"], ["disease_type", "Tipo de agente *"], ["symptoms", "Sintomas principais *"], ["favorable_conditions", "Condições favoráveis *"], ["crop_stage", "Período crítico de ocorrência *"], ["severity_level", "Nível de severidade *"], ["management_recommendations", "Manejo preventivo *"], ["preventive_control", "Controle biológico / preventivo *"], ["curative_control", "Manejo curativo / químico *"], ["technical_notes", "Observações técnicas"]];
  const visible = useMemo(() => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(search.toLowerCase())), [items, search]);

  return <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
    <Link href="/configuracoes" className="text-sm text-leaf-700 hover:underline">← Configurações</Link>
    <SectionTitle title="Doenças" subtitle="Cadastro técnico padronizado para manter o histórico fitossanitário consistente." />
    {err && <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    {msg && <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
    <div className="mt-6 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft md:p-6">
      <div className="mb-6 rounded-2xl border border-leaf-100 bg-leaf-50/40 p-4">
        <h2 className="text-base font-semibold text-[#123F2A] md:text-lg">Formulário técnico da doença</h2>
        <p className="mt-1 text-sm text-slate-600">Preencha os campos para criar ou atualizar doenças do catálogo interno com padronização técnica.</p>
      </div>
      <form onSubmit={submit}>
        <div className="grid gap-4 md:grid-cols-2">{fields.map(([k, l]) => <label key={String(k)} className="text-sm font-medium text-slate-700">{l}<textarea rows={3} required={k === "common_name"} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100" value={String(form[k] ?? "")} onChange={(e) => setForm((c) => ({ ...c, [k]: e.target.value }))} /></label>)}
          <label className="text-sm font-medium text-slate-700">Cultura vinculada<select className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100" value={form.crop_id ?? ""} onChange={e => setForm((c) => ({ ...c, crop_id: e.target.value }))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label>
        </div>
        <div className="mt-5 flex justify-end">
          <button disabled={saving} className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : null}
            {saving ? "Salvando cadastro..." : "Salvar cadastro"}
          </button>
        </div>
      </form>
    </div>

    <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <p className="font-semibold text-[#123F2A]">Doenças cadastradas</p>
        <input className="rounded-2xl border border-slate-200 p-2 text-sm md:ml-auto md:w-72" placeholder="Buscar por nome comum ou científico" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="mt-4 space-y-2">{loadingData ? <p className="text-sm text-slate-500">Carregando...</p> : visible.map(d => <article key={d.id} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3"><strong>{d.common_name}</strong><p className="text-sm text-slate-600">{d.scientific_name}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="rounded-full border border-leaf-200 bg-white px-3 py-1 text-xs font-medium text-leaf-700" onClick={() => { setForm({ ...empty, ...d, crop_id: d.crop_id ?? "" }); }}>Editar</button><button type="button" disabled={deletingId===d.id} className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 disabled:opacity-60" onClick={async () => { if (!confirm("Deseja excluir este cadastro?")) return; const t = token(); if (!t) return; setDeletingId(d.id); try { const r = await fetch(`/api/specialist/diseases?id=${encodeURIComponent(d.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } }); const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p?.error || "Falha ao excluir"); setMsg("Cadastro excluído com sucesso."); await loadData(); } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao excluir"); } finally { setDeletingId(null); } }}>{deletingId===d.id ? "Excluindo..." : "Excluir"}</button></div></article>)}</div>
    </div>
  </section>;
}

"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type CropOption = { id: string; display_name_pt: string | null; name: string };
type Role = "user" | "assistant";
type ChatTurn = { role: Role; content: string; createdAt: string };
type Disease = { id: string; common_name: string; scientific_name?: string | null; causal_agent?: string | null; disease_type?: string | null; symptoms?: string | null; favorable_conditions?: string | null; crop_stage?: string | null; severity_level?: string | null; management_recommendations?: string | null; preventive_control?: string | null; curative_control?: string | null; technical_notes?: string | null; crop_id?: string | null; is_active: boolean; };
type AiDiseaseData = { nome_comum: string; nome_cientifico: string; agente_causal: string; tipo_agente: string; sintomas_principais: string; condicoes_favoraveis: string; periodo_critico_ocorrencia: string; nivel_severidade: string; manejo_preventivo: string; controle_biologico_preventivo: string; manejo_curativo_quimico: string; };
type AiSearchResponse = { success: true; summary: string; data: AiDiseaseData; debug?: { raw_text?: string; warnings?: string[] } } | { success: false; error: string; details?: string; debug?: { raw_text?: string; warnings?: string[] } };

const empty: Disease = { id: "", common_name: "", scientific_name: "", causal_agent: "", disease_type: "", symptoms: "", favorable_conditions: "", crop_stage: "", severity_level: "", management_recommendations: "", preventive_control: "", curative_control: "", technical_notes: "", crop_id: "", is_active: true };
const now = () => new Date().toISOString();
const fillIntentRegex = /(preencher|preencha|gerar\s+dados|resumir\s+para\s+cadastro|aplicar\s+no\s+formul[aá]rio)/i;

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [search, setSearch] = useState("");
  const [seedDiseaseName, setSeedDiseaseName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary: string; data: AiDiseaseData; warnings: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
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

  const applySuggestion = useCallback((payload: { summary: string; data: AiDiseaseData; warnings: string[] } | null) => {
    if (!payload) return;
    const map: [keyof Disease, keyof AiDiseaseData][] = [["common_name", "nome_comum"], ["scientific_name", "nome_cientifico"], ["causal_agent", "agente_causal"], ["disease_type", "tipo_agente"], ["symptoms", "sintomas_principais"], ["favorable_conditions", "condicoes_favoraveis"], ["crop_stage", "periodo_critico_ocorrencia"], ["severity_level", "nivel_severidade"], ["management_recommendations", "manejo_preventivo"], ["preventive_control", "controle_biologico_preventivo"], ["curative_control", "manejo_curativo_quimico"]];
    setForm((cur) => {
      const next = { ...cur };
      for (const [field, key] of map) {
        if (editedFields.has(field)) continue;
        (next[field] as string) = String(payload.data[key] ?? "").trim();
      }
      if (!next.common_name) next.common_name = seedDiseaseName.trim();
      return next;
    });
    setMsg("Formulário preenchido com IA. Revise e edite antes de salvar.");
  }, [editedFields, seedDiseaseName]);

  async function runAi(userMessage: string) {
    const t = token();
    if (!t) return;
    const question = userMessage.trim();
    if (!question) return;
    setAiLoading(true); setErr(null); setMsg(null);
    const nextChat = [...chat, { role: "user" as const, content: question, createdAt: now() }];
    setChat(nextChat);
    setChatInput("");
    try {
      const r = await fetch("/api/specialist/ai-fill", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ type: "disease", name: seedDiseaseName.trim() || "consulta agronômica", history: nextChat.map(({ role, content }) => ({ role, content })) }) });
      const p = (await r.json()) as AiSearchResponse;
      if (!r.ok || !p.success) throw new Error(("error" in p && p.error) || "Falha na IA");
      const current = { summary: p.summary, data: p.data, warnings: p.debug?.warnings ?? [] };
      setAiResult(current);
      setChat((prev) => [...prev, { role: "assistant", content: p.summary, createdAt: now() }]);
      if (fillIntentRegex.test(question)) applySuggestion(current);
    } catch (e) {
      setErr(e instanceof Error ? `${e.message}. Tente novamente.` : "Falha de rede ao consultar IA.");
    } finally { setAiLoading(false); }
  }

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
      setForm(empty); setAiResult(null); setEditedFields(new Set()); await loadData();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar"); } finally { setSaving(false); }
  }

  const fields: Array<[keyof Disease, string]> = [["common_name", "Nome comum *"], ["scientific_name", "Nome científico *"], ["causal_agent", "Agente causal *"], ["disease_type", "Tipo de agente *"], ["symptoms", "Sintomas principais *"], ["favorable_conditions", "Condições favoráveis *"], ["crop_stage", "Período crítico de ocorrência *"], ["severity_level", "Nível de severidade *"], ["management_recommendations", "Manejo preventivo *"], ["preventive_control", "Controle biológico / preventivo *"], ["curative_control", "Manejo curativo / químico *"], ["technical_notes", "Observações técnicas"]];
  const visible = useMemo(() => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(search.toLowerCase())), [items, search]);

  return <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
    <Link href="/configuracoes" className="text-sm text-leaf-700 hover:underline">← Configurações</Link>
    <SectionTitle title="Cadastro Premium de Doenças" subtitle="Chat agronômico com IA + preenchimento estruturado seguro." />
    {err && <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    {msg && <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr,1.1fr]">
      <aside className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
        <p className="font-semibold text-[#123F2A]">Chat IA (Fitopatologia)</p>
        <input className="mt-3 w-full rounded-2xl border px-4 py-3 text-sm" value={seedDiseaseName} onChange={(e) => setSeedDiseaseName(e.target.value)} placeholder="Doença base (opcional): Ex. Antracnose" />
        <div className="mt-3 max-h-[26rem] space-y-3 overflow-auto rounded-2xl border bg-slate-50 p-3">{chat.length === 0 ? <p className="text-sm text-slate-500">Pergunte livremente sobre doenças agronômicas. Ex.: “Pesquise sobre antracnose” ou “resuma para cadastro”.</p> : chat.map((m, i) => <div key={i} className={`max-w-[90%] rounded-2xl p-3 text-sm ${m.role === "user" ? "ml-auto bg-[#123F2A] text-white" : "border border-leaf-100 bg-white text-slate-700"}`}>{m.content}</div>)}</div>
        <div className="mt-3 flex gap-2"><input className="w-full rounded-2xl border px-4 py-3 text-sm" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Digite sua pergunta..." /><button type="button" onClick={() => void runAi(chatInput)} disabled={aiLoading || !chatInput.trim()} className="rounded-full bg-leaf-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{aiLoading ? "Enviando..." : "Enviar"}</button></div>
        <button type="button" onClick={() => applySuggestion(aiResult)} disabled={!aiResult} className="mt-3 w-full rounded-full border border-leaf-300 px-4 py-2 text-sm font-semibold text-leaf-700 disabled:opacity-50">Preencher formulário com IA</button>
      </aside>

      <form onSubmit={submit} className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
        <p className="mb-4 font-semibold text-[#123F2A]">Formulário técnico</p>
        <div className="grid gap-4 md:grid-cols-2">{fields.map(([k, l]) => <label key={String(k)} className="text-sm">{l}<textarea rows={3} required={l.includes("*")} className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm" value={String(form[k] ?? "")} onChange={(e) => { setEditedFields((prev) => new Set([...prev, String(k)])); setForm((c) => ({ ...c, [k]: e.target.value })); }} /></label>)}
          <label className="text-sm">Cultura vinculada<select className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm" value={form.crop_id ?? ""} onChange={e => setForm((c) => ({ ...c, crop_id: e.target.value }))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label>
        </div>
        {aiResult?.warnings?.length ? <ul className="mt-3 list-disc rounded-2xl border border-amber-200 bg-amber-50 p-3 pl-8 text-xs text-amber-800">{aiResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
        <button disabled={saving} className="mt-4 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Salvando cadastro..." : "Salvar cadastro"}</button>
      </form>
    </div>

    <div className="mt-8 rounded-3xl border bg-white p-5"><div className="flex gap-3"><p className="font-semibold">Doenças cadastradas</p><input className="ml-auto rounded-2xl border p-2 text-sm" placeholder="Buscar" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="mt-4 space-y-2">{loadingData ? <p>Carregando...</p> : visible.map(d => <article key={d.id} className="rounded-2xl border bg-slate-50 p-3"><strong>{d.common_name}</strong><p className="text-sm">{d.scientific_name}</p><div className="mt-2 flex gap-2"><button type="button" className="rounded-full border border-leaf-200 px-3 py-1 text-xs" onClick={() => { setForm({ ...empty, ...d, crop_id: d.crop_id ?? "" }); setEditedFields(new Set()); }}>Editar</button><button type="button" disabled={deletingId===d.id} className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 disabled:opacity-60" onClick={async () => { if (!confirm("Deseja excluir este cadastro?")) return; const t = token(); if (!t) return; setDeletingId(d.id); try { const r = await fetch(`/api/specialist/diseases?id=${encodeURIComponent(d.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } }); const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p?.error || "Falha ao excluir"); setMsg("Cadastro excluído com sucesso."); await loadData(); } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao excluir"); } finally { setDeletingId(null); } }}>Excluir</button></div></article>)}</div></div>
  </section>;
}

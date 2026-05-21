"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type CropOption = { id: string; display_name_pt: string | null; name: string };
type Disease = {
  id: string;
  common_name: string;
  scientific_name?: string | null;
  causal_agent?: string | null;
  disease_type?: string | null;
  symptoms?: string | null;
  favorable_conditions?: string | null;
  crop_stage?: string | null;
  severity_level?: string | null;
  management_recommendations?: string | null;
  preventive_control?: string | null;
  curative_control?: string | null;
  technical_notes?: string | null;
  crop_id?: string | null;
  is_active: boolean;
};

type AiDiseaseData = {
  nome_comum: string;
  nome_cientifico: string;
  agente_causal: string;
  tipo_agente: string;
  sintomas_principais: string;
  condicoes_favoraveis: string;
  periodo_critico_ocorrencia: string;
  nivel_severidade: string;
  manejo_preventivo: string;
  controle_biologico_preventivo: string;
  manejo_curativo_quimico: string;
};

type AiSearchResponse =
  | { success: true; summary: string; data: AiDiseaseData; debug?: { raw_text?: string; warnings?: string[] } }
  | { success: false; error: string; details?: string };

const empty: Disease = { id: "", common_name: "", scientific_name: "", causal_agent: "", disease_type: "", symptoms: "", favorable_conditions: "", crop_stage: "", severity_level: "", management_recommendations: "", preventive_control: "", curative_control: "", technical_notes: "", crop_id: "", is_active: true };

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [q, setQ] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary: string; data: AiDiseaseData; warnings: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const token = () => getStoredSupabaseAccessToken();

  async function load() {
    const t = token();
    if (!t) return;
    const [diseasesRes, cropsRes] = await Promise.all([
      fetch("/api/specialist/diseases", { headers: { Authorization: `Bearer ${t}` } }),
      fetch("/api/specialist/crops", { headers: { Authorization: `Bearer ${t}` } }),
    ]);
    const diseasesPayload = await diseasesRes.json();
    const cropsPayload = await cropsRes.json();
    if (diseasesRes.ok) setItems(diseasesPayload.diseases ?? []);
    else setErr(diseasesPayload.error || "Erro ao carregar doenças.");
    if (cropsRes.ok) setCrops(cropsPayload.crops ?? []);
  }

  useEffect(() => { load(); }, []);

  async function fillWithAI() {
    const t = token();
    if (!t) return;
    const diseaseName = aiName.trim();
    if (!diseaseName) {
      setErr("Digite o nome da doença antes de pesquisar com IA.");
      return;
    }
    setAiLoading(true); setErr(null); setMsg(null); setAiResult(null);
    try {
      const r = await fetch("/api/specialist/ai-fill", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ type: "disease", name: diseaseName }) });
      const p = (await r.json()) as AiSearchResponse;
      if (!r.ok || !p.success) {
        const errorText = "error" in p ? p.error : "Não foi possível pesquisar a doença com IA.";
        setErr(`${errorText} Tente novamente com um nome mais específico, como 'Antracnose em tomate'.`);
        return;
      }
      setAiResult({ summary: p.summary, data: p.data, warnings: p.debug?.warnings ?? [] });
      setMsg("Pesquisa concluída. Revise o conteúdo e clique em 'Aplicar no cadastro'.");
    } catch {
      setErr("Falha de rede durante a pesquisa com IA. Verifique sua conexão e tente novamente.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion() {
    if (!aiResult) return;
    const d = aiResult.data;
    setForm((current) => ({
      ...current,
      common_name: d.nome_comum || current.common_name || aiName.trim(),
      scientific_name: d.nome_cientifico,
      causal_agent: d.agente_causal,
      disease_type: d.tipo_agente,
      symptoms: d.sintomas_principais,
      favorable_conditions: d.condicoes_favoraveis,
      crop_stage: d.periodo_critico_ocorrencia,
      severity_level: d.nivel_severidade,
      management_recommendations: d.manejo_preventivo,
      preventive_control: d.controle_biologico_preventivo,
      curative_control: d.manejo_curativo_quimico,
    }));
    setMsg("Dados aplicados ao formulário. Você pode editar qualquer campo antes de salvar.");
    setErr(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving) return;
    if (!form.common_name?.trim()) return setErr("Nome comum obrigatório para salvar o cadastro.");

    setSaving(true); setErr(null); setMsg(null);
    try {
      const method = form.id ? "PATCH" : "POST";
      const cropId = form.crop_id?.trim();
      const payload = { ...form, crop_id: cropId ? cropId : null };
      const r = await fetch("/api/specialist/diseases", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) {
        setErr(p?.error || "Falha ao salvar. Revise os dados do cadastro e tente novamente.");
        return;
      }
      setMsg("Doença salva com sucesso.");
      setForm(empty);
      await load();
    } finally { setSaving(false); }
  }

  const fields: Array<[keyof Disease, string, boolean?]> = [["common_name", "Nome comum *", true],["scientific_name", "Nome científico"],["causal_agent", "Agente causal"],["disease_type", "Tipo de agente"],["symptoms", "Sintomas principais"],["favorable_conditions", "Condições favoráveis"],["crop_stage", "Período crítico de ocorrência"],["severity_level", "Nível de severidade"],["management_recommendations", "Manejo preventivo"],["preventive_control", "Controle biológico / preventivo"],["curative_control", "Manejo curativo / químico"],["technical_notes", "Observações técnicas"]];
  const visible = useMemo(() => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(q.toLowerCase())), [items,q]);

  return <section className="mx-auto max-w-7xl px-6 py-12"><Link href="/configuracoes">← Configurações</Link><SectionTitle title="Cadastro de Doenças" subtitle="Gestão técnica de doenças para monitoramento fitossanitário." />
    {err && <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-red-700">{err}</p>}
    {msg && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{msg}</p>}

    <div className="mt-4 rounded-2xl border border-leaf-100 bg-leaf-50 p-4">
      <p className="text-sm font-semibold text-leaf-800">Pesquisa de Doenças com IA</p>
      <div className="mt-2 flex flex-col gap-2 md:flex-row">
        <input className="w-full rounded-2xl border border-leaf-100 bg-white p-3 text-sm" placeholder="Digite o nome da doença agrícola" value={aiName} onChange={(e)=>setAiName(e.target.value)} />
        <button type="button" onClick={fillWithAI} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300">{aiLoading ? "Pesquisando..." : "Pesquisar com IA"}</button>
      </div>
      {aiResult && <div className="mt-3 space-y-2 rounded-xl border border-leaf-200 bg-white p-3">
        <p className="text-xs font-semibold text-leaf-800">Resumo textual da IA</p>
        <p className="text-sm text-slate-700">{aiResult.summary}</p>
        <p className="text-xs font-semibold text-leaf-800">JSON normalizado</p>
        <pre className="overflow-x-auto text-xs text-slate-700">{JSON.stringify(aiResult.data, null, 2)}</pre>
        {aiResult.warnings.length > 0 && <p className="text-xs text-amber-700">Avisos: {aiResult.warnings.join(" ")}</p>}
        <button type="button" onClick={applySuggestion} className="rounded-full border border-leaf-300 bg-white px-5 py-2 text-sm font-semibold text-leaf-700">Aplicar no cadastro</button>
      </div>}
    </div>

    <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">{fields.map(([k,l,required]) => <label key={String(k)}>{l}<textarea required={required} className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={String(form[k] ?? "")} onChange={e => setForm((c) => ({ ...c, [k]: e.target.value }))} /></label>)}
      <label>Cultura relacionada<select className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={form.crop_id ?? ""} onChange={(e)=>setForm((c)=>({...c,crop_id:e.target.value}))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label>
      <label className="md:col-span-2"><input type="checkbox" checked={form.is_active} onChange={e=>setForm((c)=>({...c,is_active:e.target.checked}))} /> Ativa</label>
      <button disabled={saving} className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Salvando..." : "Salvar"}</button>
    </form>

    <input className="mt-4 w-full rounded border border-leaf-100 p-2" placeholder="Buscar doença" value={q} onChange={e=>setQ(e.target.value)} />
    <div className="mt-4 space-y-2">{visible.length===0 ? <p>Nenhuma doença cadastrada.</p> : visible.map(d => <article key={d.id} className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft"><strong>{d.common_name}</strong><p>{d.scientific_name}</p><p className="text-xs text-slate-500">Cultura vinculada: {crops.find((c)=>c.id===d.crop_id)?.display_name_pt || "não vinculada"}</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>setForm({ ...d, crop_id: d.crop_id ?? "" })} className="rounded-full border border-leaf-200 px-3 py-1 text-xs font-semibold text-leaf-700">Editar</button><button onClick={async()=>{ const t=token(); if(!t) return; await fetch(`/api/specialist/diseases?id=${d.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${t}`}}); load(); setMsg("Cadastro excluído com sucesso."); }} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">Excluir</button></div></article>)}</div>
  </section>;
}

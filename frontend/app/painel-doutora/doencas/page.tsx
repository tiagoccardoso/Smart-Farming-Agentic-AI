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
  | { success: false; error: string; details?: string; debug?: { raw_text?: string; warnings?: string[] } };

const empty: Disease = { id: "", common_name: "", scientific_name: "", causal_agent: "", disease_type: "", symptoms: "", favorable_conditions: "", crop_stage: "", severity_level: "", management_recommendations: "", preventive_control: "", curative_control: "", technical_notes: "", crop_id: "", is_active: true };

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [q, setQ] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary: string; data: AiDiseaseData; warnings: string[] } | null>(null);
  const [aiRawResponse, setAiRawResponse] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const token = () => getStoredSupabaseAccessToken();

  async function load() {
    const t = token();
    if (!t) return;
    setLoadingData(true);
    try {
      const [diseasesRes, cropsRes] = await Promise.all([
        fetch("/api/specialist/diseases", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/specialist/crops", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      const diseasesPayload = await diseasesRes.json();
      const cropsPayload = await cropsRes.json();
      if (diseasesRes.ok) setItems(diseasesPayload.diseases ?? []);
      else setErr(diseasesPayload.error || "Erro ao carregar doenças.");
      if (cropsRes.ok) setCrops(cropsPayload.crops ?? []);
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function fillWithAI() {
    const t = token();
    if (!t) return;
    const diseaseName = aiName.trim();
    if (!diseaseName) return setErr("Digite o nome da doença antes de pesquisar com IA.");
    setAiLoading(true); setErr(null); setMsg(null); setAiResult(null); setAiRawResponse("");
    try {
      const r = await fetch("/api/specialist/ai-fill", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ type: "disease", name: diseaseName }) });
      const p = (await r.json()) as AiSearchResponse;
      if (!r.ok || !p.success) {
        if ("debug" in p && p.debug?.raw_text) setAiRawResponse(p.debug.raw_text);
        return setErr(`${"error" in p ? p.error : "Não foi possível pesquisar a doença com IA."} Tente novamente com um nome mais específico, como 'Antracnose em tomate', ou preencha manualmente os campos abaixo.`);
      }
      setAiResult({ summary: p.summary, data: p.data, warnings: p.debug?.warnings ?? [] });
      setAiRawResponse(p.debug?.raw_text ?? "");
      setMsg("Pesquisa concluída. Revise o conteúdo e clique em 'Aplicar no cadastro'.");
    } catch {
      setErr("Falha de rede durante a pesquisa com IA. Verifique sua conexão e tente novamente.");
    } finally { setAiLoading(false); }
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

  const structuredFieldsCount = useMemo(() => {
    if (!aiResult) return 0;
    return Object.values(aiResult.data).filter((value) => String(value ?? "").trim().length > 0).length;
  }, [aiResult]);
  const canApplyAi = structuredFieldsCount >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving) return;
    const missingRequired: string[] = [];
    if (!form.common_name?.trim()) missingRequired.push("Nome comum");
    if (!form.scientific_name?.trim()) missingRequired.push("Nome científico");
    if (!form.causal_agent?.trim()) missingRequired.push("Agente causal");
    if (!form.disease_type?.trim()) missingRequired.push("Tipo de agente");
    if (!form.symptoms?.trim()) missingRequired.push("Sintomas principais");
    if (!form.favorable_conditions?.trim()) missingRequired.push("Condições favoráveis");
    if (!form.crop_stage?.trim()) missingRequired.push("Período crítico de ocorrência");
    if (!form.severity_level?.trim()) missingRequired.push("Nível de severidade");
    if (!form.management_recommendations?.trim()) missingRequired.push("Manejo preventivo");
    if (!form.preventive_control?.trim()) missingRequired.push("Controle biológico / preventivo");
    if (!form.curative_control?.trim()) missingRequired.push("Manejo curativo / químico");
    if (missingRequired.length > 0) return setErr(`Preencha os campos obrigatórios antes de salvar: ${missingRequired.join(", ")}.`);

    setSaving(true); setErr(null); setMsg(null);
    try {
      const method = form.id ? "PATCH" : "POST";
      const cropId = form.crop_id?.trim();
      const payload = { ...form, crop_id: cropId ? cropId : null };
      const r = await fetch("/api/specialist/diseases", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) return setErr(p?.error || "Falha ao salvar. Revise os dados do cadastro e tente novamente.");
      setMsg(form.id ? "Doença atualizada com sucesso." : "Doença salva com sucesso.");
      setForm(empty);
      await load();
    } finally { setSaving(false); }
  }

  const fields: Array<[keyof Disease, string, boolean?]> = [["common_name", "Nome comum *", true],["scientific_name", "Nome científico"],["causal_agent", "Agente causal"],["disease_type", "Tipo de agente"],["symptoms", "Sintomas principais"],["favorable_conditions", "Condições favoráveis"],["crop_stage", "Período crítico de ocorrência"],["severity_level", "Nível de severidade"],["management_recommendations", "Manejo preventivo"],["preventive_control", "Controle biológico / preventivo"],["curative_control", "Manejo curativo / químico"],["technical_notes", "Observações técnicas"]];
  const visible = useMemo(() => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(q.toLowerCase())), [items,q]);

  return <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
    <Link href="/configuracoes" className="text-sm text-leaf-700 hover:underline">← Configurações</Link>
    <SectionTitle title="Cadastro de Doenças" subtitle="Gestão técnica premium com preenchimento inteligente por IA." />
    {err && <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    {msg && <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

    <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
      <div className="space-y-6">
        <div className="rounded-3xl border border-leaf-100 bg-gradient-to-br from-leaf-50 to-white p-5 shadow-soft">
          <p className="text-sm font-semibold text-leaf-800">Pesquisa com IA</p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input className="w-full rounded-2xl border border-leaf-100 bg-white p-3 text-sm" placeholder="Ex.: Antracnose" value={aiName} onChange={(e)=>setAiName(e.target.value)} />
            <button type="button" onClick={fillWithAI} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-leaf-800 disabled:bg-slate-300">{aiLoading ? "Pesquisando..." : "Pesquisar com IA"}</button>
          </div>
          {!aiResult && !aiLoading && <p className="mt-3 text-xs text-slate-500">Informe uma doença para receber resumo técnico e dados estruturados.</p>}
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
          <p className="text-sm font-semibold text-leaf-800">Resposta da IA</p>
          {aiResult ? <>
            <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">{aiResult.summary}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Dados estruturados</p>
            <pre className="mt-2 max-h-72 overflow-auto rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(aiResult.data, null, 2)}</pre>
            {aiResult.warnings.length > 0 && <p className="mt-2 text-xs text-amber-700">Avisos: {aiResult.warnings.join(" ")}</p>}
            <button type="button" onClick={applySuggestion} disabled={!canApplyAi} className="mt-4 rounded-full border border-leaf-300 bg-white px-5 py-2 text-sm font-semibold text-leaf-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">Aplicar no cadastro</button>
            <p className="mt-2 text-xs text-slate-500">Campos estruturados detectados: {structuredFieldsCount}/11.</p>
          </> : <p className="mt-3 text-sm text-slate-500">Aguardando pesquisa com IA.</p>}
          {aiRawResponse && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Resposta bruta da IA (para revisão)</p>
              <pre className="mt-2 max-h-52 overflow-auto rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">{aiRawResponse}</pre>
            </>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between"><p className="font-semibold text-slate-800">Dados do cadastro</p>{form.id && <button type="button" onClick={()=>setForm(empty)} className="text-xs text-slate-500 underline">Cancelar edição</button>}</div>
        <div className="grid gap-4 md:grid-cols-2">{fields.map(([k,l,required]) => <label key={String(k)} className="text-sm text-slate-700">{l}<textarea required={required} rows={3} className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={String(form[k] ?? "")} onChange={e => setForm((c) => ({ ...c, [k]: e.target.value }))} /></label>)}
          <label className="text-sm text-slate-700">Cultura vinculada<select className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={form.crop_id ?? ""} onChange={(e)=>setForm((c)=>({...c,crop_id:e.target.value}))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2"><input type="checkbox" checked={form.is_active} onChange={e=>setForm((c)=>({...c,is_active:e.target.checked}))} /> Ativa</label>
        </div>
        <button disabled={saving} className="mt-4 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Salvando cadastro..." : form.id ? "Atualizar cadastro" : "Salvar cadastro"}</button>
      </form>
    </div>

    <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="font-semibold text-slate-800">Doenças cadastradas</p>
        <input className="w-full rounded-2xl border border-leaf-100 p-2 text-sm md:w-80" placeholder="Buscar doença" value={q} onChange={e=>setQ(e.target.value)} />
      </div>
      <div className="mt-4 space-y-3">{loadingData ? <p className="text-sm text-slate-500">Carregando registros...</p> : visible.length===0 ? <p className="text-sm text-slate-500">Nenhuma doença cadastrada.</p> : visible.map(d => <article key={d.id} className="rounded-2xl border border-leaf-100 bg-slate-50 p-4"><strong>{d.common_name}</strong><p className="text-sm text-slate-600">{d.scientific_name}</p><p className="text-xs text-slate-500">Cultura vinculada: {crops.find((c)=>c.id===d.crop_id)?.display_name_pt || "não vinculada"}</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>setForm({ ...d, crop_id: d.crop_id ?? "" })} className="rounded-full border border-leaf-200 bg-white px-3 py-1 text-xs font-semibold text-leaf-700">Editar</button><button onClick={async()=>{ if(!confirm(`Deseja excluir '${d.common_name}'?`)) return; const t=token(); if(!t) return; const response = await fetch(`/api/specialist/diseases?id=${d.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${t}`}}); if(!response.ok){const p=await response.json(); setErr(p.error||"Não foi possível excluir."); return;} await load(); setMsg("Cadastro excluído com sucesso."); }} className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700">Excluir</button></div></article>)}</div>
    </div>
  </section>;
}

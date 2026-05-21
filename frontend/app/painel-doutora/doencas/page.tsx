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
const applyIntentRegex = /(preencher\s+formul[aá]rio|aplicar\s+no\s+cadastro|usar\s+essa\s+resposta\s+no\s+formul[aá]rio|gerar\s+cadastro)/i;

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [q, setQ] = useState("");
  const [aiName, setAiName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary: string; data: AiDiseaseData; warnings: string[] } | null>(null);
  const [aiRawResponse, setAiRawResponse] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const token = () => getStoredSupabaseAccessToken();

  const loadData = useCallback(async () => {
    const t = token();
    if (!t) return;
    setLoadingData(true);
    try {
      const [d, c] = await Promise.all([
        fetch("/api/specialist/diseases", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/specialist/crops", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      const dp = await d.json();
      const cp = await c.json();
      if (d.ok) setItems(dp.diseases ?? []);
      if (c.ok) setCrops(cp.crops ?? []);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function runAi(userMessage?: string) {
    const t = token();
    if (!t) return;
    const name = aiName.trim() || userMessage?.trim();
    if (!name) return setErr("Digite o nome da doença ou uma pergunta para iniciar.");

    setAiLoading(true);
    setErr(null);
    setMsg(null);

    const turn = userMessage?.trim();
    const nextChat = turn ? [...chat, { role: "user" as const, content: turn, createdAt: now() }] : chat;
    if (turn) setChat(nextChat);

    try {
      const r = await fetch("/api/specialist/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ type: "disease", name, history: nextChat.map(({ role, content }) => ({ role, content })) }),
      });
      const p = (await r.json()) as AiSearchResponse;
      if (!r.ok || !p.success) {
        if ("debug" in p && p.debug?.raw_text) setAiRawResponse(p.debug.raw_text);
        setErr(("error" in p ? p.error : "Erro na IA") + " Você pode continuar o chat e tentar aplicar novamente.");
        return;
      }
      const assistantSummary = p.summary || "Resposta técnica recebida.";
      setChat((prev) => [...prev, { role: "assistant", content: assistantSummary, createdAt: now() }]);
      setAiResult({ summary: assistantSummary, data: p.data, warnings: p.debug?.warnings ?? [] });
      setAiRawResponse(p.debug?.raw_text ?? "");
      const askedToApply = Boolean(turn && applyIntentRegex.test(turn));
      if (askedToApply) {
        setTimeout(() => applySuggestion({ summary: assistantSummary, data: p.data, warnings: p.debug?.warnings ?? [] }), 0);
      } else {
        setMsg("Resposta atualizada. Se estiver correta, clique em 'Preencher formulário com IA'.");
      }
    } catch {
      setErr("Falha de rede ao consultar IA.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion(payload = aiResult) {
    if (!payload) return;

    const d = payload.data;
    const map: [keyof Disease, keyof AiDiseaseData][] = [["common_name", "nome_comum"], ["scientific_name", "nome_cientifico"], ["causal_agent", "agente_causal"], ["disease_type", "tipo_agente"], ["symptoms", "sintomas_principais"], ["favorable_conditions", "condicoes_favoraveis"], ["crop_stage", "periodo_critico_ocorrencia"], ["severity_level", "nivel_severidade"], ["management_recommendations", "manejo_preventivo"], ["preventive_control", "controle_biologico_preventivo"], ["curative_control", "manejo_curativo_quimico"]];
    setForm((cur) => {
      const n = { ...cur };
      for (const [field, key] of map) {
        if (editedFields.has(field)) continue;
        (n[field] as string) = String(d[key] ?? "").trim();
      }
      if (!n.common_name) n.common_name = aiName.trim();
      return n;
    });
    setMsg("Dados aplicados no formulário sem sobrescrever campos já editados manualmente.");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const cropId = form.crop_id?.trim();
      const payload = { ...form, crop_id: cropId ? cropId : null };
      const r = await fetch("/api/specialist/diseases", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) {
        setErr(p?.error || "Falha ao salvar");
        return;
      }
      setMsg(form.id ? "Doença atualizada com sucesso." : "Doença salva com sucesso.");
      setForm(empty);
      setAiResult(null);
      setAiRawResponse("");
      setEditedFields(new Set());
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<[keyof Disease, string]> = [["common_name", "Nome comum *"], ["scientific_name", "Nome científico *"], ["causal_agent", "Agente causal *"], ["disease_type", "Tipo de agente *"], ["symptoms", "Sintomas principais *"], ["favorable_conditions", "Condições favoráveis *"], ["crop_stage", "Período crítico de ocorrência *"], ["severity_level", "Nível de severidade *"], ["management_recommendations", "Manejo preventivo *"], ["preventive_control", "Controle biológico / preventivo *"], ["curative_control", "Manejo curativo / químico *"], ["technical_notes", "Observações técnicas"]];
  const visible = useMemo(() => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(q.toLowerCase())), [items, q]);

  return <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
    <Link href="/configuracoes" className="text-sm text-leaf-700 hover:underline">← Configurações</Link>
    <SectionTitle title="Cadastro de Doenças" subtitle="Fluxo premium com chat IA, normalização robusta e preenchimento assistido." />
    {err && <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    {msg && <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
      <div className="space-y-6">
        <div className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
          <p className="font-semibold">Assistente IA para Fitopatologia</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input className="w-full rounded-2xl border p-3" value={aiName} onChange={e => setAiName(e.target.value)} placeholder="Ex.: Ferrugem asiática da soja" />
            <button type="button" onClick={() => runAi()} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300">{aiLoading ? "Analisando..." : "Pesquisar"}</button>
          </div>
          <div className="mt-4 max-h-80 space-y-2 overflow-auto rounded-2xl border bg-slate-50 p-3">{chat.length === 0 ? <p className="text-sm text-slate-500">Pergunte sobre doença específica ou consulta ampla. O histórico é mantido para respostas progressivas.</p> : chat.map((m, i) => <p key={i} className={`rounded-xl p-2 text-sm ${m.role === 'user' ? 'ml-8 border bg-white' : 'mr-8 border border-leaf-100 bg-leaf-50'}`}><strong>{m.role === 'user' ? 'Você' : 'IA'}:</strong> {m.content}</p>)}</div>
          <div className="mt-3 flex gap-3">
            <input className="w-full rounded-2xl border p-3" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ex.: detalhe sintomas em alta umidade" />
            <button type="button" onClick={() => { const v = chatInput.trim(); if (!v) return; setChatInput(""); void runAi(v); }} disabled={aiLoading} className="rounded-full border px-4 py-2 text-sm disabled:opacity-60">Enviar</button>
          </div>
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
          <p className="font-semibold">Saída técnica e dados estruturados</p>
          {aiResult ? <>
            <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">{aiResult.summary}</p>
            {aiResult.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-3 pl-8 text-xs text-amber-800">{aiResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border bg-slate-50 p-3 text-xs">{JSON.stringify(aiResult.data, null, 2)}</pre>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => applySuggestion()} className="rounded-full border border-leaf-300 px-4 py-2 text-sm font-semibold text-leaf-700">Preencher formulário com IA</button>{aiRawResponse ? <button type="button" onClick={() => { try { const b = aiRawResponse.trim(); const f = b.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const raw = f ?? b.slice(Math.max(0,b.indexOf('{')), b.lastIndexOf('}')+1); const data = JSON.parse(raw) as Partial<AiDiseaseData>; applySuggestion({ summary: "JSON reaproveitado da resposta bruta.", warnings: ["Conversão manual aplicada."], data: { nome_comum: String(data.nome_comum ?? ""), nome_cientifico: String(data.nome_cientifico ?? ""), agente_causal: String(data.agente_causal ?? ""), tipo_agente: String(data.tipo_agente ?? ""), sintomas_principais: String(data.sintomas_principais ?? ""), condicoes_favoraveis: String(data.condicoes_favoraveis ?? ""), periodo_critico_ocorrencia: String(data.periodo_critico_ocorrencia ?? ""), nivel_severidade: String(data.nivel_severidade ?? ""), manejo_preventivo: String(data.manejo_preventivo ?? ""), controle_biologico_preventivo: String(data.controle_biologico_preventivo ?? ""), manejo_curativo_quimico: String(data.manejo_curativo_quimico ?? "") } }); } catch { setErr("Não foi possível converter automaticamente. Peça para IA gerar o cadastro novamente."); } }} className="rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700">Tentar converter resposta bruta</button> : null}</div>
          </> : <p className="mt-3 text-sm text-slate-500">Aguardando resposta da IA.</p>}
          {aiRawResponse && <pre className="mt-3 max-h-48 overflow-auto rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">{aiRawResponse}</pre>}
        </div>
      </div>

      <form onSubmit={submit} className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft">
        <p className="mb-4 font-semibold">Formulário técnico</p>
        <div className="grid gap-4 md:grid-cols-2">{fields.map(([k, l]) => <label key={String(k)} className="text-sm">{l}<textarea rows={3} required={l.includes("*")} className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm" value={String(form[k] ?? "")} onChange={e => { setEditedFields((prev) => new Set([...prev, String(k)])); setForm((c) => ({ ...c, [k]: e.target.value })); }} /></label>)}
          <label className="text-sm">Cultura vinculada<select className="mt-1 w-full rounded-2xl border px-4 py-3 text-sm" value={form.crop_id ?? ""} onChange={e => setForm((c) => ({ ...c, crop_id: e.target.value }))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label>
        </div>
        <button disabled={saving} className="mt-4 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Salvando cadastro..." : "Salvar cadastro"}</button>
      </form>
    </div>

    <div className="mt-8 rounded-3xl border bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="font-semibold">Doenças cadastradas</p><input className="rounded-2xl border p-2 text-sm" placeholder="Buscar" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="mt-4 space-y-2">{loadingData ? <p>Carregando...</p> : visible.map(d => <article key={d.id} className="rounded-2xl border bg-slate-50 p-3"><strong>{d.common_name}</strong><p className="text-sm">{d.scientific_name}</p><div className="mt-2 flex gap-2"><button type="button" className="rounded-full border border-leaf-200 px-3 py-1 text-xs" onClick={() => { setForm({ ...empty, ...d, crop_id: d.crop_id ?? "" }); setEditedFields(new Set()); }}>Editar</button><button type="button" disabled={deletingId===d.id} className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 disabled:opacity-60" onClick={async () => { if (!confirm("Deseja excluir este cadastro?")) return; const t = token(); if (!t) return; setDeletingId(d.id); try { const r = await fetch(`/api/specialist/diseases?id=${encodeURIComponent(d.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } }); const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p?.error || "Falha ao excluir"); setMsg("Cadastro excluído com sucesso."); await loadData(); } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao excluir"); } finally { setDeletingId(null); } }}>Excluir</button></div></article>)}</div>
    </div>
  </section>;
}

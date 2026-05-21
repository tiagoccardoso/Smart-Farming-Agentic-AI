"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import ChatBubble from "../../../components/ChatBubble";

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

const empty: Disease = {
  id: "",
  common_name: "",
  scientific_name: "",
  causal_agent: "",
  disease_type: "",
  symptoms: "",
  favorable_conditions: "",
  crop_stage: "",
  severity_level: "",
  management_recommendations: "",
  preventive_control: "",
  curative_control: "",
  technical_notes: "",
  crop_id: "",
  is_active: true,
};

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(empty);
  const [q, setQ] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [diseaseSuggestion, setDiseaseSuggestion] = useState<Partial<Disease> | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [aiRawResponse, setAiRawResponse] = useState<string>("");
  const [lastApplySummary, setLastApplySummary] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    load();
  }, []);

  async function fillWithAI() {
    const t = token();
    if (!t) return;
    if (!aiName.trim()) {
      setErr("Informe o nome da doença para preenchimento com IA.");
      return;
    }
    setAiLoading(true);
    setErr(null);
    setMsg("Consultando IA e organizando uma sugestão (aceita respostas parciais)...");
    setLastApplySummary(null);
    try {
      const r = await fetch("/api/specialist/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ type: "disease", name: aiName.trim() }),
      });
      const p = await r.json();
      if (!r.ok) {
        const errorCode = typeof p?.code === "string" ? p.code : "";
        if (errorCode === "ai_configuration_error") setErr("A IA não está configurada no servidor. Contate o administrador.");
        else if (errorCode === "ai_invalid_request" || errorCode === "ai_model_not_found") setErr("A configuração do modelo de IA está incompatível no servidor. Contate o administrador.");
        else if (["ai_provider_unavailable", "ai_rate_limit"].includes(errorCode) || r.status === 429 || r.status >= 500) setErr("A IA está temporariamente indisponível. Tente novamente em instantes.");
        else if (errorCode === "ai_invalid_json" || errorCode === "ai_no_usable_data" || r.status === 422) setErr(p.error || "A IA respondeu sem dados úteis para aplicação automática. Ajuste a pergunta e tente novamente.");
        else if (errorCode === "ai_unknown_error") setErr("Erro inesperado ao processar a resposta da IA.");
        else setErr(p.error || "Falha na chamada da IA para gerar sugestão.");
        return;
      }
      const rawSuggestion = p.suggestion ?? {};
      const suggestedCropId = typeof rawSuggestion.crop_id === "string" ? rawSuggestion.crop_id : null;
      const validCropId = suggestedCropId && crops.some((c) => c.id === suggestedCropId) ? suggestedCropId : "";
      const normalizedSuggestion = {
        common_name: String(rawSuggestion.common_name ?? aiName.trim()),
        scientific_name: String(rawSuggestion.scientific_name ?? ""),
        causal_agent: String(rawSuggestion.causal_agent ?? ""),
        disease_type: String(rawSuggestion.disease_type ?? ""),
        symptoms: String(rawSuggestion.symptoms ?? ""),
        favorable_conditions: String(rawSuggestion.favorable_conditions ?? ""),
        crop_stage: String(rawSuggestion.crop_stage ?? ""),
        severity_level: String(rawSuggestion.severity_level ?? ""),
        management_recommendations: String(rawSuggestion.management_recommendations ?? ""),
        preventive_control: String(rawSuggestion.preventive_control ?? ""),
        curative_control: String(rawSuggestion.curative_control ?? ""),
        technical_notes: String(rawSuggestion.technical_notes ?? ""),
        crop_id: validCropId,
        is_active: typeof rawSuggestion.is_active === "boolean" ? rawSuggestion.is_active : true,
      };

      if (!normalizedSuggestion.common_name.trim()) {
        setErr("A IA retornou dados recuperáveis, mas sem nome comum da doença.");
        return;
      }

      setDiseaseSuggestion(normalizedSuggestion);
      setAiRawResponse(JSON.stringify(normalizedSuggestion, null, 2));
      setChatMessages((current) => [
        ...current,
        { role: "user", text: aiName.trim() },
        { role: "assistant", text: p?.assistant_message || p?.message || "Sugestão gerada. Clique em aplicar no cadastro para preencher o formulário." },
      ]);
      const warnings = Array.isArray(p.warnings) ? p.warnings.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const filledFieldsCount = Object.entries(normalizedSuggestion)
        .filter(([key, value]) => key !== "id" && key !== "crop_id" && key !== "is_active" && typeof value === "string" && value.trim().length > 0)
        .length;
      setMsg(warnings.length > 0
        ? `Sugestão gerada com avisos: ${warnings.join(" ")} Clique em aplicar no cadastro.`
        : filledFieldsCount <= 2
          ? "Resposta parcial recebida. Você pode aplicar os campos disponíveis e completar manualmente."
          : "Sugestão gerada. Clique em “Aplicar no cadastro”.");
    } catch (error) {
      setErr("Falha na chamada da IA. Verifique sua conexão e tente novamente.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion() {
    if (!diseaseSuggestion) return;
    setApplyingSuggestion(true);
    let applied = 0;
    let preserved = 0;
    setForm((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(diseaseSuggestion)) {
        if (key === "id" || value === undefined || value === null) continue;
        const typedKey = key as keyof Disease;
        const nextValue = String(value);
        if (typedKey === "is_active") {
          next.is_active = Boolean(value);
          continue;
        }
        const currentValue = String(current[typedKey] ?? "").trim();
        if (!currentValue && nextValue.trim()) {
          (next[typedKey] as unknown as string) = nextValue;
          applied += 1;
        } else if (currentValue && nextValue.trim() && currentValue !== nextValue) {
          preserved += 1;
        }
      }
      next.id = current.id;
      return next;
    });
    setApplyingSuggestion(false);
    setLastApplySummary(`Campos preenchidos automaticamente: ${applied}. Campos já preenchidos preservados: ${preserved}.`);
    setMsg("Dados da IA aplicados sem sobrescrever campos já preenchidos. Revise antes de salvar.");
    setErr(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving) return;
    if (!form.common_name?.trim()) {
      setErr("Nome comum obrigatório.");
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const method = form.id ? "PATCH" : "POST";
      const payload = { ...form, crop_id: form.crop_id?.trim() ? form.crop_id.trim() : null };
      const r = await fetch("/api/specialist/diseases", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) {
        setErr("Não foi possível salvar o cadastro. Revise os dados e tente novamente.");
        return;
      }
      setMsg("Cadastro salvo com sucesso.");
      setForm(empty);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<[keyof Disease, string, boolean?]> = [
    ["common_name", "Nome comum *", true],
    ["scientific_name", "Nome científico"],
    ["causal_agent", "Agente causal"],
    ["disease_type", "Tipo de agente"],
    ["symptoms", "Sintomas principais"],
    ["favorable_conditions", "Condições favoráveis"],
    ["crop_stage", "Período crítico de ocorrência"],
    ["severity_level", "Nível de severidade"],
    ["management_recommendations", "Manejo preventivo"],
    ["preventive_control", "Controle biológico / preventivo"],
    ["curative_control", "Manejo curativo / químico"],
    ["technical_notes", "Observações técnicas"],
  ];

  const visible = items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return <section className="mx-auto max-w-7xl px-6 py-12"><Link href="/configuracoes">← Configurações</Link><SectionTitle title="Cadastro de Doenças" subtitle="Gestão técnica de doenças para monitoramento fitossanitário." />{err && <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-red-700">{err}</p>}{msg && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{msg}</p>}<div className="mb-4 mt-4 rounded-2xl border border-leaf-100 bg-leaf-50 p-4"><p className="text-sm font-semibold text-leaf-800">Chat de preenchimento assistido por IA</p><div className="mt-2 flex flex-col gap-2 md:flex-row"><input className="w-full rounded-2xl border border-leaf-100 bg-white p-3 text-sm" placeholder="Digite o nome ou uma descrição da doença" value={aiName} onChange={e => setAiName(e.target.value)} /><button type="button" onClick={fillWithAI} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300">{aiLoading ? "Consultando..." : "Enviar para IA"}</button></div><div className="mt-3 space-y-2">{chatMessages.length === 0 ? <p className="text-xs text-slate-600">Pesquise uma doença, revise a resposta textual e aplique apenas os dados úteis no formulário.</p> : chatMessages.map((message, index) => <ChatBubble key={`${message.role}-${index}`} role={message.role} text={message.text} />)}</div>{aiRawResponse && <div className="mt-3 rounded-xl border border-leaf-200 bg-white p-3"><p className="text-xs font-semibold text-leaf-800">JSON normalizado da IA (parcial quando necessário)</p><pre className="mt-2 overflow-x-auto text-xs text-slate-700">{aiRawResponse}</pre></div>} {lastApplySummary && <p className="mt-2 text-xs text-slate-600">{lastApplySummary}</p>}<div className="mt-3"><button type="button" onClick={applySuggestion} disabled={!diseaseSuggestion || applyingSuggestion || aiLoading} className="rounded-full border border-leaf-300 bg-white px-5 py-2 text-sm font-semibold text-leaf-700 disabled:cursor-not-allowed disabled:opacity-60">{applyingSuggestion ? "Aplicando..." : "Aplicar no cadastro"}</button></div></div><form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">{fields.map(([k, l, required]) => <label key={String(k)}>{l}<textarea required={required} className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={String(form[k] ?? "")} onChange={e => setForm((c) => ({ ...c, [k]: e.target.value }))} /></label>)}<label>Cultura relacionada<select className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={form.crop_id ?? ""} onChange={(e) => setForm((c) => ({ ...c, crop_id: e.target.value }))}><option value="">Não vinculada</option>{crops.map(c => <option key={c.id} value={c.id}>{c.display_name_pt || c.name}</option>)}</select></label><label className="md:col-span-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm((c) => ({ ...c, is_active: e.target.checked }))} /> Ativa</label><button disabled={saving} className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Salvando..." : "Salvar"}</button></form><input className="mt-4 w-full rounded border border-leaf-100 p-2" placeholder="Buscar doença" value={q} onChange={e => setQ(e.target.value)} /><div className="mt-4 space-y-2">{visible.length === 0 ? <p>Nenhuma doença cadastrada.</p> : visible.map(d => <article key={d.id} className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft"><strong>{d.common_name}</strong><p>{d.scientific_name}</p><p className="text-xs text-slate-500">Cultura vinculada: {crops.find((c) => c.id === d.crop_id)?.display_name_pt || "não vinculada"}</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setForm({ ...d, crop_id: d.crop_id ?? "" })} className="rounded-full border border-leaf-200 px-3 py-1 text-xs font-semibold text-leaf-700">Editar</button><button onClick={async () => { const t = token(); if (!t) return; await fetch(`/api/specialist/diseases?id=${d.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${t}` } }); load(); setMsg("Cadastro excluído com sucesso."); }} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">Excluir</button></div></article>)}</div></section>;
}

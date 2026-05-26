"use client";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../../lib/auth";
import { getCurrentAuthSession, getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import { acompanhamentoModules } from "../modules";

type RecordItem = { id: string; title: string; amount?: number | null; property_id?: string | null; data?: Record<string, unknown> };
type PropertyOption = { id: string; name: string; owner_name: string | null };
type CropOption = { id: string; display_name_pt: string | null; name: string | null };
type DiseaseOption = { id: string; common_name: string; disease_type?: string | null; is_active?: boolean };
type PropertyRecord = { id: string; name: string; owner_name: string | null; location_gps: string | null; total_area_ha: number | null; sectors: string[]; soil_type: string | null; altitude_m: number | null; area_history: string | null; photo_urls: string[] };
type Field = { key: string; label: string; required?: boolean; type?: "text"|"textarea"|"date"|"currency"|"select"|"file"; options?: string[] };

const moduleFields: Record<string, Field[]> = {
  "cadastro-propriedade": [{ key: "nome_propriedade", label: "Nome da propriedade", required: true }, { key: "proprietario", label: "Proprietário", required: true }, { key: "localizacao_gps", label: "Localização/GPS", required: true }, { key: "area_total", label: "Área total", required: true }, { key: "talhoes_setores", label: "Talhões/setores", required: true }, { key: "tipo_solo", label: "Tipo de solo", required: true }, { key: "altitude", label: "Altitude" }, { key: "historico_area", label: "Histórico da área", type: "textarea" }, { key: "fotos_propriedade", label: "Fotos da propriedade", type: "file" }],
  "historico-culturas": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "cultura_atual", label: "Cultura atual", type: "select", required: true }, { key: "culturas_anteriores", label: "Culturas anteriores" }, { key: "rotacao_culturas", label: "Rotação" }, { key: "data_plantio", label: "Data de plantio", type: "date", required: true }, { key: "data_colheita", label: "Data de colheita", type: "date" }, { key: "cultivar_hibrido", label: "Cultivar/híbrido" }, { key: "populacao_ha", label: "População/planta por hectare" }],
  "analise-solo": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "safra", label: "Safra", required: true }, { key: "data_analise", label: "Data da análise", type: "date", required: true }, { key: "laboratorio", label: "Laboratório" }, { key: "anexo_analise", label: "PDF/anexo", type: "file" }, { key: "ph", label: "pH" }, { key: "mo", label: "MO" }, { key: "p", label: "P" }, { key: "k", label: "K" }, { key: "ca", label: "Ca" }, { key: "mg", label: "Mg" }, { key: "al", label: "Al" }, { key: "s", label: "S" }, { key: "saturacao_bases", label: "Saturação por bases" }, { key: "ctc", label: "CTC" }, { key: "micronutrientes", label: "Micronutrientes", type: "textarea" }, { key: "observacoes", label: "Observações", type: "textarea" }],
  "mapa-area": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "nome_ponto", label: "Nome", required: true }, { key: "tipo_registro", label: "Tipo", type: "select", required: true, options: ["talhão", "reboleira", "foco de doença", "coleta de solo", "ponto GPS"] }, { key: "latitude", label: "Latitude", required: true }, { key: "longitude", label: "Longitude", required: true }, { key: "observacoes", label: "Observações", type: "textarea" }, { key: "foto", label: "Foto", type: "file" }],
  "monitoramento-fitossanitario": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "doenca_praga", label: "Doença/praga", type: "select", required: true, options: ["antracnose", "ferrugem", "requeima", "greening", "mofo-branco"] }, { key: "severidade", label: "Severidade", required: true }, { key: "fotos", label: "Fotos", type: "file" }, { key: "data_inspecao", label: "Data da inspeção", type: "date", required: true }, { key: "clima_periodo", label: "Clima no período" }, { key: "produtos_aplicados", label: "Produtos aplicados" }, { key: "recomendacao_tecnica", label: "Recomendação técnica", type: "textarea" }, { key: "observacoes", label: "Observações", type: "textarea" }],
  "aplicacoes-manejo": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "tipo_aplicacao", label: "Tipo", required: true }, { key: "pulverizacoes", label: "Pulverizações" }, { key: "fertilizantes_aplicados", label: "Fertilizantes aplicados" }, { key: "dose", label: "Dose" }, { key: "volume_calda", label: "Volume de calda" }, { key: "equipamento_usado", label: "Equipamento usado" }, { key: "operador", label: "Operador" }, { key: "condicoes_climaticas", label: "Condições climáticas" }, { key: "receituario", label: "Receituário", type: "file" }, { key: "data_aplicacao", label: "Data da aplicação", type: "date", required: true }],
  "controle-climatico": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "cultura_relacionada", label: "Cultura", type: "select", required: true, options: ["tomate", "soja", "uva", "citrus"] }, { key: "data", label: "Data", type: "date", required: true }, { key: "chuva_acumulada", label: "Chuva acumulada" }, { key: "temperatura", label: "Temperatura" }, { key: "umidade", label: "Umidade" }, { key: "horas_molhamento_foliar", label: "Horas de molhamento foliar" }, { key: "risco_doencas", label: "Risco de doenças" }, { key: "observacoes", label: "Observações", type: "textarea" }],
  "financeiro-area": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "safra", label: "Safra", required: true }, { key: "custo_talhao", label: "Custo por talhão", type: "currency" }, { key: "custo_safra", label: "Custo por safra", type: "currency" }, { key: "produtividade", label: "Produtividade" }, { key: "lucro_estimado", label: "Lucro estimado", type: "currency" }, { key: "custo_aplicacao", label: "Custo de aplicação", type: "currency" }, { key: "custo_nutricional", label: "Custo nutricional", type: "currency" }, { key: "observacoes", label: "Observações", type: "textarea" }],
  "relatorios-automaticos": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "data_visita", label: "Data visita", type: "date", required: true }, { key: "tipo_relatorio", label: "Tipo", required: true }, { key: "recomendacoes", label: "Recomendações", type: "textarea" }, { key: "fotos_relatorio", label: "Fotos", type: "file" }, { key: "assinatura_digital", label: "Assinatura digital" }, { key: "historico_visitas", label: "Histórico de visitas", type: "textarea" }, { key: "observacoes", label: "Observações", type: "textarea" }, { key: "status_relatorio", label: "Status", required: true }],
  "inteligencia-artificial": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "tipo_analise", label: "Tipo", required: true }, { key: "arquivo", label: "Arquivo", type: "file" }, { key: "entrada_usuario", label: "Entrada enviada pelo usuário", type: "textarea" }, { key: "resultado_ia", label: "Resultado da IA", type: "textarea" }, { key: "status", label: "Status" }, { key: "data", label: "Data", type: "date" }, { key: "observacoes", label: "Observações", type: "textarea" }]
};

export default function Page() {
  const { modulo } = useParams<{ modulo: string }>();
  const moduleData = useMemo(() => acompanhamentoModules.find((x) => x.slug === modulo), [modulo]);
  const fields = useMemo(() => moduleFields[modulo] ?? [], [modulo]);
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(false);
  const [diseases, setDiseases] = useState<DiseaseOption[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatMessages, setChatMessages] = useState<{role:"user"|"assistant";content:string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ id: "" });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const hasAccess = ["admin", "specialist"].includes(profile?.role ?? "");
  const fileFields = new Set(fields.filter((x) => x.type === "file").map((x) => x.key));
  const cropFieldKeys = new Set(fields.filter((x) => /(cultura|culturas|safra)/i.test(`${x.key} ${x.label}`)).map((x) => x.key));

  async function load() {
    const token = getStoredSupabaseAccessToken(); if (!token || !moduleData) return;
    const [a, b] = await Promise.all([fetch(moduleData.slug === "cadastro-propriedade" ? "/api/acompanhamento/properties" : `/api/acompanhamento/${moduleData.slug}`, { headers: { Authorization: `Bearer ${token}` } }), fetch("/api/acompanhamento/properties", { headers: { Authorization: `Bearer ${token}` } })]);
    if (a.ok) {
      const payload = await a.json();
      if (moduleData.slug === "cadastro-propriedade") {
        const mapped = (payload.properties ?? []).map((p: PropertyRecord) => ({ id: p.id, title: p.name, data: { nome_propriedade: p.name, proprietario: p.owner_name ?? "", localizacao_gps: p.location_gps ?? "", area_total: p.total_area_ha ?? "", talhoes_setores: (p.sectors || []).join(", "), tipo_solo: p.soil_type ?? "", altitude: p.altitude_m ?? "", historico_area: p.area_history ?? "", fotos_propriedade: (p.photo_urls || []).join(", ") } }));
        setRecords(mapped);
      } else setRecords(payload.records ?? []);
    }
    if (b.ok) setProperties((await b.json()).properties ?? []);
  }

  async function loadCrops() {
    setLoadingCrops(true);
    try {
      const res = await fetch("/api/crops");
      if (!res.ok) return;
      const payload = await res.json();
      setCrops(payload.crops ?? []);
    } finally {
      setLoadingCrops(false);
    }
  }

  useEffect(() => { (async () => { try { const s = await getCurrentAuthSession(); if (!s?.access_token) return router.push("/login"); setProfile(s.profile ?? null); } finally { setLoading(false); } })(); }, [router]);
  useEffect(() => { if (hasAccess) load(); }, [hasAccess, moduleData?.slug]);
  useEffect(() => { if (hasAccess && cropFieldKeys.size > 0) loadCrops(); }, [hasAccess, cropFieldKeys.size]);
  useEffect(() => { if (!hasAccess) return; const t=getStoredSupabaseAccessToken(); if(!t) return; fetch("/api/specialist/diseases",{headers:{Authorization:`Bearer ${t}`}}).then(r=>r.json()).then(p=>setDiseases((p.diseases??[]).filter((d:DiseaseOption)=>d.is_active!==false))).catch(()=>setDiseases([])); }, [hasAccess]);

  if (!moduleData) return notFound();
  if (loading) return <p className="p-6">Carregando...</p>;
  if (!hasAccess) return <p className="p-6">Acesso restrito.</p>;

  async function uploadFile(file: File) {
    const token = getStoredSupabaseAccessToken();
    const fd = new FormData(); fd.set("file", file); fd.set("modulo", modulo);
    const res = await fetch("/api/acompanhamento/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Falha no upload");
    return payload.fileUrl as string;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) if (f.required && !String(form[f.key] ?? "").trim()) return setMessage({ type: "error", text: `Campo obrigatório: ${f.label}.` });
    setSaving(true); setMessage(null);
    try {
      const data = { ...form } as Record<string, unknown>;
      for (const key of fileFields) {
        const raw = data[key];
        if (raw instanceof File) data[key] = await uploadFile(raw);
      }
      const token = getStoredSupabaseAccessToken();
      const amount = form.custo_safra ? Number(form.custo_safra.replace(/\./g, "").replace(",", ".")) : null;
      const isProperty = modulo === "cadastro-propriedade";
      const res = await fetch(isProperty ? (form.id ? `/api/acompanhamento/properties/${form.id}` : "/api/acompanhamento/properties") : (form.id ? `/api/acompanhamento/${modulo}/${form.id}` : `/api/acompanhamento/${modulo}`), { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(isProperty ? { name: form.nome_propriedade, owner_name: form.proprietario, location_gps: form.localizacao_gps || null, total_area_ha: form.area_total ? Number(String(form.area_total).replace(",", ".")) : null, sectors: form.talhoes_setores ? String(form.talhoes_setores).split(",").map((x) => x.trim()).filter(Boolean) : [], soil_type: form.tipo_solo || null, altitude_m: form.altitude ? Number(form.altitude) : null, area_history: form.historico_area || null, photo_urls: form.fotos_propriedade ? [String(form.fotos_propriedade)] : [] } : { title: form.nome_propriedade || form.cultura_atual || form.safra || "Registro", property_id: form.property_id || null, amount, data }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Erro");
      setMessage({ type: "success", text: "Cadastro salvo com sucesso." }); setForm({ id: "" }); load();
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? "Não foi possível salvar o cadastro no momento." : "Não foi possível salvar o cadastro no momento." }); }
    finally { setSaving(false); }
  }

  return <section className="mx-auto max-w-7xl px-4 py-8 md:px-6"><Link href="/acompanhamento" className="text-sm font-semibold text-leaf-700">← Voltar</Link><div className="mt-4 rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft md:p-8"><h1 className="text-2xl font-bold text-[#123F2A]">{moduleData.title}</h1><p className="mt-1 text-sm text-[#717973]">Preencha os campos abaixo para criar ou atualizar o cadastro.</p>{message && <p className={`mt-4 rounded-2xl border p-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message.text}</p>}<form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">{fields.map((f) => { const isCropField = cropFieldKeys.has(f.key); return <label key={f.key} className="text-sm font-medium text-[#414943]">{f.label}{f.required ? " *" : ""}{f.type === "textarea" ? <textarea className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} /> : f.type === "select" ? <select className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}><option value="">{loadingCrops && isCropField ? "Carregando culturas..." : "Selecione"}</option>{isCropField ? crops.map((c) => { const cropName = c.display_name_pt || c.name || ""; return <option key={c.id} value={cropName}>{cropName}</option>; }) : f.key === "doenca_praga" ? diseases.map((d)=><option key={d.id} value={d.common_name}>{d.common_name}</option>) : f.options ? f.options.map((o) => <option key={o} value={o}>{o}</option>) : properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : f.type === "file" ? <input className="mt-1 w-full rounded-2xl border border-dashed border-leaf-200 bg-white px-3 py-2 text-sm" type="file" onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.files?.[0] as unknown as string || "" }))} /> : <input className="mt-1 w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm" type={f.type === "date" ? "date" : "text"} placeholder={f.type === "currency" ? "R$ 1.234,56" : undefined} value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />}{isCropField && !loadingCrops && crops.length === 0 ? <span className="mt-1 block text-xs text-[#717973]">Nenhuma cultura cadastrada no sistema.</span> : null}</label>; })}<div className="md:col-span-2 flex justify-end"><button disabled={saving} className="inline-flex min-w-44 items-center justify-center rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Salvando..." : "Salvar cadastro"}</button></div></form></div><div className="mt-6 space-y-3">{records.length === 0 ? <p className="rounded-2xl border border-leaf-100 bg-white p-4 text-sm text-[#414943]">Nenhum registro cadastrado.</p> : records.map((r) => <article key={r.id} className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft"><strong className="text-[#123F2A]">{r.title}</strong><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-full border border-leaf-200 px-3 py-1 text-xs font-semibold text-leaf-700" onClick={() => setForm({ id: r.id, property_id: r.property_id ?? "", ...Object.fromEntries(Object.entries(r.data ?? {}).map(([k, v]) => [k, String(v ?? "")])) })}>Editar</button><button className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700" onClick={async () => { if (!confirm("Deseja excluir este registro?")) return; const token = getStoredSupabaseAccessToken(); const d = await fetch(modulo === "cadastro-propriedade" ? `/api/acompanhamento/properties/${r.id}` : `/api/acompanhamento/${modulo}/${r.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (d.ok) { setMessage({ type: "success", text: "Cadastro excluído com sucesso." }); load(); } }}>Excluir</button></div></article>)}</div>{modulo === "inteligencia-artificial" ? <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-4 shadow-soft"><h2 className="font-semibold text-[#123F2A]">Chat de IA para acompanhamento</h2><div className="mt-3 max-h-80 space-y-2 overflow-auto">{chatMessages.length===0?<p className="text-sm text-[#717973]">Pergunte sobre manejo, cálculos agronômicos ou dúvidas técnicas deste acompanhamento.</p>:chatMessages.map((m,i)=><p key={i} className={`rounded-2xl p-3 text-sm ${m.role==="user"?"bg-leaf-50":"bg-[#f8f3ea]"}`}>{m.content}</p>)}</div><form onSubmit={async (e)=>{e.preventDefault(); const q=chatText.trim(); if(!q||chatLoading) return; const token=getStoredSupabaseAccessToken(); if(!token) return; setChatMessages(c=>[...c,{role:"user",content:q}]); setChatText(""); setChatLoading(true); try{ const r=await fetch('/api/qa',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({question:`Contexto do módulo ${moduleData.title}. ${q}`})}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'Falha ao consultar IA'); setChatMessages(c=>[...c,{role:"assistant",content:`${p.answer}

⚠️ Orientação técnica de apoio. Valide presencialmente antes de decisões críticas.`}]); }catch(err){ setChatMessages(c=>[...c,{role:"assistant",content:err instanceof Error?err.message:'Erro ao consultar IA'}]); } finally{ setChatLoading(false);} }} className="mt-3 flex gap-2"><input className="flex-1 rounded-2xl border border-leaf-100 px-4 py-3 text-sm" value={chatText} onChange={(e)=>setChatText(e.target.value)} placeholder="Digite sua pergunta" /><button disabled={chatLoading||!chatText.trim()} className="rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white disabled:opacity-60">{chatLoading?"Enviando...":"Enviar"}</button></form></div> : null}</section>;
}

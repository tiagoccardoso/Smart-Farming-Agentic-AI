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
  const [form, setForm] = useState<Record<string, string>>({ id: "" });
  const [message, setMessage] = useState<string | null>(null);
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
    for (const f of fields) if (f.required && !String(form[f.key] ?? "").trim()) return setMessage(`Campo obrigatório: ${f.label}.`);
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
      setMessage("Registro salvo com sucesso."); setForm({ id: "" }); load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Erro"); }
    finally { setSaving(false); }
  }

  return <section className="mx-auto max-w-6xl px-4 py-8"><Link href="/acompanhamento">← Voltar</Link><h1 className="text-2xl font-bold">{moduleData.title}</h1>{message && <p>{message}</p>}<form onSubmit={submit} className="grid gap-3 md:grid-cols-2">{fields.map((f) => { const isCropField = cropFieldKeys.has(f.key); return <label key={f.key} className="text-sm">{f.label}{f.required ? " *" : ""}{f.type === "textarea" ? <textarea className="w-full border p-2" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} /> : f.type === "select" ? <select className="w-full border p-2" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}><option value="">{loadingCrops && isCropField ? "Carregando culturas..." : "Selecione"}</option>{isCropField ? crops.map((c) => { const cropName = c.display_name_pt || c.name || ""; return <option key={c.id} value={cropName}>{cropName}</option>; }) : f.options ? f.options.map((o) => <option key={o} value={o}>{o}</option>) : properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : f.type === "file" ? <input className="w-full" type="file" onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.files?.[0] as unknown as string || "" }))} /> : <input className="w-full border p-2" type={f.type === "date" ? "date" : "text"} placeholder={f.type === "currency" ? "R$ 1.234,56" : undefined} value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />}{isCropField && !loadingCrops && crops.length === 0 ? <span className="mt-1 block text-xs text-slate-500">Nenhuma cultura cadastrada no sistema.</span> : null}</label>; })}<button disabled={saving} className="rounded bg-green-700 p-2 text-white">{saving ? "Salvando..." : "Salvar"}</button></form><div className="mt-6 space-y-3">{records.length === 0 ? <p>Nenhum registro cadastrado.</p> : records.map((r) => <article key={r.id} className="rounded border p-3"><strong>{r.title}</strong><div className="mt-2 flex gap-3"><button onClick={() => setForm({ id: r.id, property_id: r.property_id ?? "", ...Object.fromEntries(Object.entries(r.data ?? {}).map(([k, v]) => [k, String(v ?? "")])) })}>Editar</button><button onClick={async () => { if (!confirm("Deseja excluir este registro?")) return; const token = getStoredSupabaseAccessToken(); const d = await fetch(modulo === "cadastro-propriedade" ? `/api/acompanhamento/properties/${r.id}` : `/api/acompanhamento/${modulo}/${r.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (d.ok) { setMessage("Registro excluído com sucesso."); load(); } }}>Excluir</button></div></article>)}</div></section>;
}

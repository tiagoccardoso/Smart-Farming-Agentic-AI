"use client";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../../lib/auth";
import { getCurrentAuthSession, getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import { acompanhamentoModules } from "../modules";

type RecordItem = { id: string; title: string; amount?: number | null; property_id?: string | null; data?: Record<string, unknown> };
type PropertyOption = { id: string; name: string; owner_name: string | null };
type Field = { key: string; label: string; required?: boolean; type?: "text"|"textarea"|"date"|"currency"|"select"|"file"; options?: string[] };

const moduleFields: Record<string, Field[]> = {
  "cadastro-propriedade": [{ key: "nome_propriedade", label: "Nome da propriedade", required: true }, { key: "proprietario", label: "Proprietário", required: true }, { key: "localizacao_gps", label: "Localização/GPS", required: true }, { key: "area_total", label: "Área total", required: true }, { key: "talhoes_setores", label: "Talhões/setores", required: true }, { key: "tipo_solo", label: "Tipo de solo", required: true }, { key: "altitude", label: "Altitude" }, { key: "historico_area", label: "Histórico da área", type: "textarea" }, { key: "fotos_propriedade", label: "Fotos da propriedade", type: "file" }],
  "historico-culturas": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "cultura_atual", label: "Cultura atual", required: true }, { key: "culturas_anteriores", label: "Culturas anteriores" }, { key: "rotacao_culturas", label: "Rotação" }, { key: "data_plantio", label: "Data de plantio", type: "date", required: true }, { key: "data_colheita", label: "Data de colheita", type: "date" }, { key: "cultivar_hibrido", label: "Cultivar/híbrido" }, { key: "populacao_ha", label: "População/planta por hectare" }],
  "analise-solo": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "safra", label: "Safra", required: true }, { key: "data_analise", label: "Data da análise", type: "date", required: true }, { key: "laboratorio", label: "Laboratório" }, { key: "anexo_analise", label: "PDF/anexo", type: "file" }],
  "mapa-area": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "nome_ponto", label: "Nome", required: true }, { key: "tipo_registro", label: "Tipo", type: "select", required: true, options: ["talhão", "reboleira", "foco de doença", "coleta de solo", "ponto GPS"] }, { key: "latitude", label: "Latitude", required: true }, { key: "longitude", label: "Longitude", required: true }, { key: "foto", label: "Foto", type: "file" }],
  "monitoramento-fitossanitario": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "doenca_praga", label: "Doença/praga", type: "select", required: true, options: ["antracnose", "ferrugem", "requeima", "greening", "mofo-branco"] }, { key: "severidade", label: "Severidade", required: true }, { key: "fotos", label: "Fotos", type: "file" }, { key: "data_inspecao", label: "Data da inspeção", type: "date", required: true }],
  "aplicacoes-manejo": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "tipo_aplicacao", label: "Tipo", required: true }, { key: "receituario", label: "Receituário", type: "file" }, { key: "data_aplicacao", label: "Data da aplicação", type: "date", required: true }],
  "controle-climatico": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "cultura_relacionada", label: "Cultura", type: "select", required: true, options: ["tomate", "soja", "uva", "citrus"] }, { key: "data", label: "Data", type: "date", required: true }],
  "financeiro-area": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "talhao_setor", label: "Talhão/setor", required: true }, { key: "safra", label: "Safra", required: true }, { key: "custo_safra", label: "Custo safra", type: "currency" }],
  "relatorios-automaticos": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "data_visita", label: "Data visita", type: "date", required: true }, { key: "tipo_relatorio", label: "Tipo", required: true }, { key: "status_relatorio", label: "Status", required: true }, { key: "fotos_relatorio", label: "Fotos", type: "file" }],
  "inteligencia-artificial": [{ key: "property_id", label: "Propriedade", type: "select", required: true }, { key: "tipo_analise", label: "Tipo", required: true }, { key: "arquivo", label: "Arquivo", type: "file" }]
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
  const [form, setForm] = useState<Record<string, string>>({ id: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasAccess = ["admin", "specialist"].includes(profile?.role ?? "");
  const fileFields = new Set(fields.filter((x) => x.type === "file").map((x) => x.key));

  async function load() {
    const token = getStoredSupabaseAccessToken(); if (!token || !moduleData) return;
    const [a, b] = await Promise.all([fetch(`/api/acompanhamento/${moduleData.slug}`, { headers: { Authorization: `Bearer ${token}` } }), fetch("/api/acompanhamento/properties", { headers: { Authorization: `Bearer ${token}` } })]);
    if (a.ok) setRecords((await a.json()).records ?? []); if (b.ok) setProperties((await b.json()).properties ?? []);
  }

  useEffect(() => { (async () => { try { const s = await getCurrentAuthSession(); if (!s?.access_token) return router.push("/login"); setProfile(s.profile ?? null); } finally { setLoading(false); } })(); }, [router]);
  useEffect(() => { if (hasAccess) load(); }, [hasAccess, moduleData?.slug]);

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
      const res = await fetch(form.id ? `/api/acompanhamento/${modulo}/${form.id}` : `/api/acompanhamento/${modulo}`, { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: form.nome_propriedade || form.cultura_atual || form.safra || "Registro", property_id: form.property_id || null, amount, data }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Erro");
      setMessage("Registro salvo com sucesso."); setForm({ id: "" }); load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Erro"); }
    finally { setSaving(false); }
  }

  return <section className="mx-auto max-w-6xl px-4 py-8"><Link href="/acompanhamento">← Voltar</Link><h1 className="text-2xl font-bold">{moduleData.title}</h1>{message && <p>{message}</p>}<form onSubmit={submit} className="grid gap-3 md:grid-cols-2">{fields.map((f) => <label key={f.key} className="text-sm">{f.label}{f.required ? " *" : ""}{f.type === "textarea" ? <textarea className="w-full border p-2" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} /> : f.type === "select" ? <select className="w-full border p-2" value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}><option value="">Selecione</option>{f.options ? f.options.map((o) => <option key={o} value={o}>{o}</option>) : properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : f.type === "file" ? <input className="w-full" type="file" onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.files?.[0] as unknown as string || "" }))} /> : <input className="w-full border p-2" type={f.type === "date" ? "date" : "text"} value={String(form[f.key] ?? "")} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />}</label>)}<button disabled={saving} className="rounded bg-green-700 p-2 text-white">{saving ? "Salvando..." : "Salvar"}</button></form><div className="mt-6 space-y-3">{records.length === 0 ? <p>Nenhum registro cadastrado.</p> : records.map((r) => <article key={r.id} className="rounded border p-3"><strong>{r.title}</strong><div className="mt-2 flex gap-3"><button onClick={() => setForm({ id: r.id, property_id: r.property_id ?? "", ...Object.fromEntries(Object.entries(r.data ?? {}).map(([k, v]) => [k, String(v ?? "")])) })}>Editar</button><button onClick={async () => { if (!confirm("Deseja excluir este registro?")) return; const token = getStoredSupabaseAccessToken(); const d = await fetch(`/api/acompanhamento/${modulo}/${r.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (d.ok) { setMessage("Registro excluído com sucesso."); load(); } }}>Excluir</button></div></article>)}</div></section>;
}

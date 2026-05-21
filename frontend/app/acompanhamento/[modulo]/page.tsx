"use client";

import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "../../../lib/auth";
import { getCurrentAuthSession, getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";
import { acompanhamentoModules } from "../modules";

type RecordItem = { id: string; title: string; status?: string | null; record_date?: string | null; amount?: number | null; property_id?: string | null; data?: Record<string, unknown>; created_at?: string };
type PropertyOption = { id: string; name: string; owner_name: string | null };
type Field = { key: string; label: string; required?: boolean; type?: "text"|"textarea"|"date"|"number"|"currency"|"select"|"file"; options?: string[] };

const diseaseLibrary = ["antracnose", "ferrugem", "requeima", "greening", "mofo-branco"];
const moduleFields: Record<string, Field[]> = {
  "cadastro-propriedade": [
    { key: "nome_propriedade", label: "Nome da propriedade", required: true }, { key: "proprietario", label: "Proprietário", required: true }, { key: "localizacao_gps", label: "Localização/GPS", required: true }, { key: "area_total", label: "Área total (ha)", type: "number", required: true }, { key: "talhoes_setores", label: "Talhões/setores", required: true }, { key: "tipo_solo", label: "Tipo de solo", required: true }, { key: "altitude", label: "Altitude (m)", type: "number" }, { key: "historico_area", label: "Histórico da área", type: "textarea" }, { key: "fotos_propriedade", label: "Fotos da propriedade", type: "file" }
  ],
  "historico-culturas": [
    { key: "property_id", label: "Propriedade vinculada", required: true, type: "select" }, { key: "cultura_atual", label: "Cultura atual", required: true }, { key: "culturas_anteriores", label: "Culturas anteriores" }, { key: "rotacao_culturas", label: "Rotação de culturas" }, { key: "data_plantio", label: "Data de plantio", type: "date", required: true }, { key: "data_colheita", label: "Data de colheita", type: "date" }, { key: "cultivar_hibrido", label: "Cultivar/híbrido utilizado" }, { key: "populacao_ha", label: "População/planta por hectare", type: "number" }
  ],
  "analise-solo": [{ key: "property_id", label: "Propriedade vinculada", required: true, type: "select" }, { key: "safra", label: "Safra", required: true }, { key: "data_analise", label: "Data da análise", type: "date", required: true }, { key: "laboratorio", label: "Laboratório" }, { key: "anexo_analise", label: "PDF/anexo da análise", type: "file" }, { key: "ph", label: "pH", type: "number" }, { key: "mo", label: "MO", type: "number" }, { key: "p", label: "P", type: "number" }, { key: "k", label: "K", type: "number" }, { key: "ca", label: "Ca", type: "number" }, { key: "mg", label: "Mg", type: "number" }, { key: "al", label: "Al", type: "number" }, { key: "s", label: "S", type: "number" }, { key: "saturacao_bases", label: "Saturação por bases", type: "number" }, { key: "ctc", label: "CTC", type: "number" }, { key: "micronutrientes", label: "Micronutrientes", type: "textarea" }, { key: "observacoes", label: "Observações", type: "textarea" }],
};

function getFields(slug: string): Field[] { return moduleFields[slug] ?? [{ key: "property_id", label: "Propriedade vinculada", type: "select", required: true }, { key: "descricao", label: "Descrição", required: true }, { key: "observacoes", label: "Observações", type: "textarea" }]; }

export default function AcompanhamentoModuloPage() {
  const params = useParams<{ modulo: string }>(); const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [records, setRecords] = useState<RecordItem[]>([]); const [properties, setProperties] = useState<PropertyOption[]>([]); const [message, setMessage] = useState<string | null>(null); const [form, setForm] = useState<Record<string, string>>({ id: "", title: "", status: "ativo", record_date: "" });
  const moduleData = useMemo(() => acompanhamentoModules.find((item) => item.slug === params.modulo), [params.modulo]);
  const hasAccess = ["admin", "specialist"].includes(profile?.role ?? "");
  const fields = useMemo(() => getFields(params.modulo), [params.modulo]);

  async function loadRecords() { const token = getStoredSupabaseAccessToken(); if (!token || !moduleData) return; const response = await fetch(`/api/acompanhamento/${moduleData.slug}`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json(); if (response.ok) setRecords(payload.records ?? []); }
  async function loadProperties() { const token = getStoredSupabaseAccessToken(); if (!token) return; const response = await fetch("/api/acompanhamento/properties", { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json(); if (response.ok) setProperties(payload.properties ?? []); }

  useEffect(() => { let active = true; (async () => { try { const session = await getCurrentAuthSession(); if (!session?.access_token) return router.push("/login"); if (active) setProfile(session.profile ?? null); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, [router]);
  useEffect(() => { if (hasAccess) { loadRecords(); loadProperties(); } }, [hasAccess, moduleData?.slug]);

  if (!moduleData) return notFound(); if (loading) return <div className="mx-auto max-w-6xl px-6 py-12"><p className="animate-pulse rounded-2xl border border-leaf-100 bg-white p-4 text-sm text-slate-500">Carregando...</p></div>; if (!hasAccess) return <div className="mx-auto max-w-6xl px-6 py-12"><div className="rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">Acesso restrito a administradores e especialistas.</div></div>;

  const submit = async (event: React.FormEvent) => { event.preventDefault();
    for (const field of fields) if (field.required && !String(form[field.key] ?? "").trim()) return setMessage(`Campo obrigatório: ${field.label}.`);
    setSaving(true); setMessage(null); const token = getStoredSupabaseAccessToken();
    const payloadData: Record<string, unknown> = {}; for (const f of fields) if (!["property_id"].includes(f.key)) payloadData[f.key] = form[f.key] ?? "";
    const title = form.nome_propriedade || form.cultura_atual || form.safra || form.descricao || `Registro ${new Date().toLocaleDateString("pt-BR")}`;
    const body = { title, status: form.status || null, record_date: form.record_date || null, property_id: form.property_id || null, amount: form.custo_safra ? Number(form.custo_safra.replace(".", "").replace(",", ".")) : null, data: payloadData };
    const url = form.id ? `/api/acompanhamento/${moduleData.slug}/${form.id}` : `/api/acompanhamento/${moduleData.slug}`; const method = form.id ? "PUT" : "POST";
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); const payload = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(payload.error || "Erro ao salvar."); setForm({ id: "", title: "", status: "ativo", record_date: "" }); setMessage("Registro salvo com sucesso."); loadRecords(); };

  return <section className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
    <Link href="/acompanhamento" className="text-sm font-semibold text-leaf-700">← Voltar</Link><h1 className="mt-3 text-3xl font-bold text-[#123F2A]">{moduleData.title}</h1><p className="mt-2 text-slate-600">{moduleData.description}</p>
    {params.modulo === "monitoramento-fitossanitario" && <p className="mt-2 text-xs text-slate-500">Biblioteca inicial: {diseaseLibrary.join(", ")}.</p>}
    {message ? <p className="mt-3 rounded-xl border border-leaf-100 bg-leaf-50 p-3 text-sm">{message}</p> : null}
    <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-leaf-100 bg-white p-4 md:grid-cols-2">
      {fields.map((field) => <label key={field.key} className={field.type === "textarea" ? "md:col-span-2 text-sm" : "text-sm"}><span className="mb-1 block font-semibold">{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea className="w-full rounded-xl border p-2" value={form[field.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))} /> : field.type === "select" ? <select className="w-full rounded-xl border p-2" value={form[field.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}><option value="">Selecione</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.owner_name ?? "sem proprietário"})</option>)}</select> : <input className="w-full rounded-xl border p-2" type={field.type === "file" ? "text" : field.type ?? "text"} placeholder={field.type === "file" ? "Upload habilitado via endpoint de anexos (próxima etapa)." : ""} value={form[field.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))} />}</label>)}
      <div className="md:col-span-2 flex gap-2"><button className="rounded-xl bg-leaf-600 px-4 py-2 text-white" disabled={saving}>{saving ? "Salvando..." : form.id ? "Atualizar" : "Novo cadastro"}</button>{form.id ? <button type="button" className="rounded-xl border px-4 py-2" onClick={() => setForm({ id: "", title: "", status: "ativo", record_date: "" })}>Cancelar edição</button> : null}</div>
    </form>
    <div className="mt-6 space-y-3">{records.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Nenhum registro cadastrado.</p> : records.map((item) => <article key={item.id} className="rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{item.title}</h2><div className="flex gap-2"><button className="text-sm text-blue-700" onClick={() => setForm({ id: item.id, status: item.status ?? "", record_date: item.record_date ?? "", property_id: item.property_id ?? "", ...Object.fromEntries(Object.entries((item.data ?? {}) as Record<string, unknown>).map(([k,v]) => [k, String(v ?? "")])) })}>Editar</button><button className="text-sm text-red-700" onClick={async () => { if (!confirm("Deseja excluir este registro?")) return; const token = getStoredSupabaseAccessToken(); const r = await fetch(`/api/acompanhamento/${moduleData.slug}/${item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (r.ok) { setMessage("Registro excluído com sucesso."); loadRecords(); } }}>Excluir</button></div></div></article>)}</div>
  </section>;
}

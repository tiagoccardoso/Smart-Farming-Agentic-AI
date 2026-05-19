"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { getCurrentAuthSession } from "../../../../lib/supabaseAuth";

type SitePageForm = { title: string; subtitle: string; image_url: string; content: Record<string, any> };
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];

const labels: Record<string, string> = { especialista: "Editar página da especialista", home: "Editar página inicial", "agricultura-organica": "Editar página Agricultura Orgânica" };
const textFields: Record<string, Array<{ key: string; label: string; rows?: number }>> = { especialista: [{ key: "professionalTitle", label: "Título profissional" }, { key: "summary", label: "Resumo profissional", rows: 5 }, { key: "platformText", label: "Texto sobre atuação na plataforma", rows: 4 }, { key: "ctaFinal", label: "CTA final", rows: 3 }], home: [{ key: "heroText", label: "Texto de apoio", rows: 4 }, { key: "primaryButtonText", label: "Texto do botão principal" }, { key: "primaryButtonUrl", label: "Link do botão principal" }, { key: "secondaryButtonText", label: "Texto do botão secundário" }, { key: "secondaryButtonUrl", label: "Link do botão secundário" }, { key: "organicSectionTitle", label: "Título da seção de agricultura orgânica" }, { key: "organicSectionText", label: "Texto da seção de agricultura orgânica", rows: 4 }], "agricultura-organica": [{ key: "intro", label: "Texto introdutório", rows: 5 }, { key: "ctaText", label: "Texto do CTA" }] };
const textListFields: Record<string, Array<{ key: string; label: string }>> = { especialista: [{ key: "education", label: "Formação" }, { key: "experiences", label: "Experiências" }, { key: "competencies", label: "Competências" }], home: [{ key: "cards", label: "Cards/destaques da seção inicial" }], "agricultura-organica": [{ key: "benefits", label: "Benefícios da agricultura orgânica" }, { key: "challenges", label: "Desafios da conversão" }, { key: "steps", label: "Etapas da conversão" }, { key: "services", label: "Serviços oferecidos" }] };

export default function SitePageEditor() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [form, setForm] = useState<SitePageForm>({ title: "", subtitle: "", image_url: "", content: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const title = useMemo(() => labels[slug] || "Editar página", [slug]);

  useEffect(() => { (async () => { try { setLoading(true); const s = await getCurrentAuthSession(); if (!s?.access_token) return router.push("/login"); const r = await fetch(`/api/admin/site-pages/${slug}`, { headers: { Authorization: `Bearer ${s.access_token}` } }); const p = await r.json(); if (!r.ok) throw new Error(p?.error || "Não foi possível carregar a página."); const next = { title: p.page?.title || "", subtitle: p.page?.subtitle || "", image_url: p.page?.image_url || "", content: p.page?.content || {} }; setForm(next); setPreview(next.image_url || ""); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar a página."); } finally { setLoading(false); } })(); }, [router, slug]);

  const updateContent = (key: string, value: string) => setForm((c) => ({ ...c, content: { ...c.content, [key]: value } }));
  const updateList = (key: string, value: string) => setForm((c) => ({ ...c, content: { ...c.content, [key]: value.split("\n").map((x) => x.trim()).filter(Boolean) } }));

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setMessage(""); setError("");
    if (!ACCEPTED_MIME.includes(file.type)) return setError("Formato de imagem inválido. Envie JPG, PNG ou WEBP.");
    if (file.size > MAX_IMAGE_SIZE) return setError("Imagem muito grande. Envie um arquivo menor.");
    setPreview(URL.createObjectURL(file));
    try {
      setUploading(true);
      const session = await getCurrentAuthSession(); if (!session?.access_token) throw new Error("Sessão expirada.");
      const fd = new FormData(); fd.set("image", file);
      const r = await fetch(`/api/admin/site-pages/${slug}/image`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: fd });
      const p = await r.json(); if (!r.ok) throw new Error(p?.error || "Não foi possível enviar a imagem. Tente novamente.");
      setForm((c) => ({ ...c, image_url: p.image_url }));
      setMessage("Imagem enviada com sucesso.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível enviar a imagem. Tente novamente."); } finally { setUploading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setSaving(true); setMessage(""); setError("");
    try { const s = await getCurrentAuthSession(); if (!s?.access_token) throw new Error("Sessão expirada."); const r = await fetch(`/api/admin/site-pages/${slug}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify(form) }); const p = await r.json(); if (!r.ok) throw new Error(p?.error || "Não foi possível salvar as alterações. Tente novamente."); setMessage(slug === "home" ? "Página inicial atualizada com sucesso." : "Página da especialista atualizada com sucesso."); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar as alterações. Tente novamente."); } finally { setSaving(false); }
  }

  if (loading) return <div className="mx-auto max-w-5xl px-6 py-14">Carregando editor...</div>;
  return <div className="mx-auto max-w-5xl px-6 py-14"><Link href="/painel-doutora" className="text-sm font-semibold text-leaf-700">← Voltar ao Painel da Doutora</Link><h1 className="mt-4 text-3xl font-bold text-[#123F2A]">{title}</h1>{message && <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}{error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}<form onSubmit={submit} className="mt-6 grid gap-5 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft"><label><span className="text-sm font-semibold">Título principal</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label><label><span className="text-sm font-semibold">Subtítulo principal</span><input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label><label className="block"><span className="text-sm font-semibold">{slug === "home" ? "Enviar imagem da página inicial" : "Enviar imagem"}</span><input aria-label={slug === "home" ? "Enviar imagem da página inicial" : "Enviar imagem"} accept=".jpg,.jpeg,.png,.webp" type="file" onChange={onUpload} className="mt-2 block w-full text-sm" /></label>{preview && <div className="rounded-2xl border border-leaf-100 p-3"><img src={preview} alt={slug === "home" ? "Produção agrícola orgânica com tecnologia e orientação especializada no campo." : "Pré-visualização da foto da especialista"} className="max-h-72 w-full rounded-2xl object-cover" /></div>}
{textFields[slug]?.map((f)=><label key={f.key}><span className="text-sm font-semibold">{f.label}</span><textarea rows={f.rows||2} value={String(form.content[f.key]||"")} onChange={(e)=>updateContent(f.key,e.target.value)} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>)}
{textListFields[slug]?.map((f)=><label key={f.key}><span className="text-sm font-semibold">{f.label} (um item por linha)</span><textarea rows={6} value={Array.isArray(form.content[f.key])?form.content[f.key].join("\n"):""} onChange={(e)=>updateList(f.key,e.target.value)} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>)}
<button type="submit" disabled={saving||uploading} className="rounded-full bg-leaf-600 px-6 py-3 font-semibold text-white disabled:bg-slate-300">{saving?"Salvando...":"Salvar alterações"}</button></form></div>;
}

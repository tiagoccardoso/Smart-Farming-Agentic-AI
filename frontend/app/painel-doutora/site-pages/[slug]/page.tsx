"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getCurrentAuthSession } from "../../../../lib/supabaseAuth";

type SitePageForm = { title: string; subtitle: string; image_url: string; content: Record<string, any> };

const labels: Record<string, string> = {
  especialista: "Editar página da especialista",
  "agricultura-organica": "Editar página Agricultura Orgânica",
};

const textListFields: Record<string, Array<{ key: string; label: string }>> = {
  especialista: [
    { key: "education", label: "Formação" },
    { key: "experiences", label: "Experiências" },
    { key: "competencies", label: "Competências" },
  ],
  "agricultura-organica": [
    { key: "benefits", label: "Benefícios da agricultura orgânica" },
    { key: "challenges", label: "Desafios da conversão" },
    { key: "steps", label: "Etapas da conversão" },
    { key: "services", label: "Serviços oferecidos" },
  ],
};

const textFields: Record<string, Array<{ key: string; label: string; rows?: number }>> = {
  especialista: [
    { key: "professionalTitle", label: "Título profissional" },
    { key: "summary", label: "Resumo profissional", rows: 5 },
    { key: "platformText", label: "Texto sobre atuação na plataforma", rows: 4 },
    { key: "ctaFinal", label: "CTA final", rows: 3 },
  ],
  "agricultura-organica": [
    { key: "intro", label: "Texto introdutório", rows: 5 },
    { key: "ctaText", label: "Texto do CTA" },
  ],
};

export default function SitePageEditor() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;
  const [form, setForm] = useState<SitePageForm>({ title: "", subtitle: "", image_url: "", content: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const title = useMemo(() => labels[slug] || "Editar página", [slug]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const session = await getCurrentAuthSession();
        if (!session?.access_token) {
          router.push("/login");
          return;
        }
        const response = await fetch(`/api/admin/site-pages/${slug}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar a página.");
        setForm({ title: payload.page?.title || "", subtitle: payload.page?.subtitle || "", image_url: payload.page?.image_url || "", content: payload.page?.content || {} });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível carregar a página.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, slug]);

  function updateContent(key: string, value: string) {
    setForm((current) => ({ ...current, content: { ...current.content, [key]: value } }));
  }

  function updateList(key: string, value: string) {
    setForm((current) => ({ ...current, content: { ...current.content, [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const session = await getCurrentAuthSession();
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const response = await fetch(`/api/admin/site-pages/${slug}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o conteúdo.");
      setMessage(payload?.message || "Conteúdo salvo com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o conteúdo.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl px-6 py-14">Carregando editor...</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <Link href="/painel-doutora" className="text-sm font-semibold text-leaf-700">← Voltar ao Painel da Doutora</Link>
      <h1 className="mt-4 text-3xl font-bold text-[#123F2A]">{title}</h1>
      <p className="mt-2 text-slate-600">Atualize os conteúdos públicos sem expor dados pessoais sensíveis. Use o formulário oficial para contatos.</p>
      {message && <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      <form onSubmit={submit} className="mt-6 grid gap-5 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <label className="block"><span className="text-sm font-semibold text-slate-700">Nome exibido / título principal</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>
        <label className="block"><span className="text-sm font-semibold text-slate-700">Subtítulo</span><input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>
        <label className="block"><span className="text-sm font-semibold text-slate-700">Foto / imagem ou ilustração (URL)</span><input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://... ou /images/arquivo.svg" className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>
        {(textFields[slug] || []).map((field) => <label key={field.key} className="block"><span className="text-sm font-semibold text-slate-700">{field.label}</span><textarea rows={field.rows || 2} value={String(form.content[field.key] || "")} onChange={(e) => updateContent(field.key, e.target.value)} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>)}
        {(textListFields[slug] || []).map((field) => <label key={field.key} className="block"><span className="text-sm font-semibold text-slate-700">{field.label} (um item por linha)</span><textarea rows={6} value={Array.isArray(form.content[field.key]) ? form.content[field.key].join("\n") : ""} onChange={(e) => updateList(field.key, e.target.value)} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3" /></label>)}
        <button type="submit" disabled={saving} aria-busy={saving} className="rounded-full bg-leaf-600 px-6 py-3 font-semibold text-white shadow-soft disabled:bg-slate-300">{saving ? "Salvando..." : "Salvar conteúdo público"}</button>
      </form>
    </div>
  );
}

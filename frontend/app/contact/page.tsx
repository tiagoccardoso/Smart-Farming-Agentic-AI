"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const visitTypes = ["visita_agricultura_organica", "conversao_propriedade_organica"];
const initialForm = { name: "", email: "", phone: "", city: "", state: "", preferredDate: "", preferredTime: "", requestType: "consultoria_geral", message: "" };

export default function ContactPage() {
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const requestType = qs.get("requestType");
    if (requestType) setForm((prev) => ({ ...prev, requestType }));
  }, []);

  const isVisit = visitTypes.includes(form.requestType);
  const submissionKey = useMemo(() => {
    const base = `${form.name}|${form.email}|${form.phone}|${form.requestType}|${form.preferredDate}|${form.preferredTime}|${form.message}`.toLowerCase();
    let hash = 0;
    for (let index = 0; index < base.length; index += 1) hash = (hash * 31 + base.charCodeAt(index)) >>> 0;
    return `contact-${Date.now()}-${hash}`;
  }, [form]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSuccess("");
    setError("");

    if (isVisit && (!form.phone || !form.city || !form.state || !form.preferredDate || !form.preferredTime)) {
      setError("Preencha telefone, cidade, estado, dia e horário para solicitações de visita.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": submissionKey },
        body: JSON.stringify({ ...form, submissionKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Erro ao enviar solicitação.");
      setSuccess("Recebemos sua solicitação. A especialista entrará em contato para confirmar as informações.");
      setForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar solicitação.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-[#fef9f0] px-6 py-14">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-[#123F2A]/10 bg-white p-7 shadow-soft md:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2E7D32]">Contato oficial Plantasã</p>
          <h1 className="mt-3 text-4xl font-bold text-[#123F2A]">Fale com a especialista</h1>
          <p className="mt-4 max-w-3xl leading-7 text-[#414943]">
            Envie sua necessidade de consultoria, revisão de caso agrícola ou avaliação para agricultura orgânica. O retorno será feito pelo canal informado para confirmar as informações.
          </p>
        </section>

        <form onSubmit={submit} className="mt-8 grid gap-5 rounded-[2rem] border border-[#123F2A]/10 bg-white p-6 shadow-soft md:grid-cols-2 md:p-8">
          <Field label="Nome" required value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <Field label="E-mail" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
          <Field label="Telefone" required={isVisit} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
          <Field label="Cidade" required={isVisit} value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
          <Field label="Estado" required={isVisit} value={form.state} onChange={(value) => setForm({ ...form, state: value })} />
          <label className="block">
            <span className="text-sm font-semibold text-[#414943]">Tipo de solicitação</span>
            <select value={form.requestType} onChange={(event) => setForm({ ...form, requestType: event.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100">
              <option value="consultoria_geral">Consultoria geral</option>
              <option value="revisao_caso_agricola">Revisão de caso agrícola</option>
              <option value="visita_agricultura_organica">Visita para agricultura orgânica</option>
              <option value="conversao_propriedade_organica">Conversão de propriedade para orgânica</option>
            </select>
          </label>
          <Field label="Data desejada" type="date" required={isVisit} value={form.preferredDate} onChange={(value) => setForm({ ...form, preferredDate: value })} />
          <Field label="Horário desejado" required={isVisit} value={form.preferredTime} onChange={(value) => setForm({ ...form, preferredTime: value })} />
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-[#414943]">Mensagem / descrição da necessidade</span>
            <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100" rows={5} placeholder="Descreva a cultura, propriedade, problema observado ou objetivo da consultoria." />
          </label>

          {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 md:col-span-2">{error}</p>}
          {success && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 md:col-span-2">
              <p className="text-sm font-bold text-emerald-800">Solicitação enviada com sucesso!</p>
              <p className="mt-1 text-sm text-emerald-700">{success}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            aria-disabled={submitting}
            aria-busy={submitting}
            className="relative overflow-hidden rounded-full bg-[#123F2A] px-6 py-3 font-semibold text-white shadow-soft transition hover:bg-[#0F3322] disabled:cursor-not-allowed md:col-span-2"
          >
            <span className={`absolute inset-y-0 left-0 bg-[#A7C957]/35 ${submitting ? "animate-[submitProgress_1.2s_ease-in-out_infinite]" : "w-0"}`} aria-hidden="true" />
            <span className="relative">{submitting ? "Enviando..." : success ? "Solicitação enviada com sucesso!" : "Enviar solicitação"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#414943]">{label}{required ? " *" : ""}</span>
      <input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100" />
    </label>
  );
}

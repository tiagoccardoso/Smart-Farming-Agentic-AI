"use client";

/**
 * Presencial & Projetos Especiais — solicitação de orcamento.
 *
 * Categoria sob consulta: nenhuma cobrança automática antes da definição do
 * orcamento. Se o usuário estiver autenticado, os dados já conhecidos e as
 * propriedades cadastradas sao preenchidos automaticamente.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import { QUOTE_SERVICE_LABELS, QUOTE_SERVICE_TYPES } from "../../lib/service-quotes";

type Property = { id: string; name: string; location_gps: string | null };

const SERVICE_OPTIONS = QUOTE_SERVICE_TYPES.map((value) => ({ value, label: QUOTE_SERVICE_LABELS[value] }));

const inputClass =
  "mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none transition focus:border-leaf-400 focus:ring-4 focus:ring-leaf-100";

export default function SolicitarOrcamentoPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    serviceType: "visita_tecnica",
    propertyId: "",
    description: "",
    notes: ""
  });

  useEffect(() => {
    let active = true;

    fetch("/api/service-quotes", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (!active || !payload) return;
        setAuthenticated(Boolean(payload.authenticated));
        setProperties(Array.isArray(payload.properties) ? payload.properties : []);
        if (payload.prefill) {
          setForm((current) => ({
            ...current,
            name: payload.prefill.name || current.name,
            email: payload.prefill.email || current.email,
            phone: payload.prefill.phone || current.phone
          }));
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/service-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...form, propertyId: form.propertyId || null })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível registrar a solicitação.");
      }

      setSuccess(payload?.message || "Solicitação registrada.");
      setForm((current) => ({ ...current, description: "", notes: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a solicitação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <Link href="/planos" className="text-sm font-semibold text-leaf-700">
        ← Voltar para os planos
      </Link>

      <div className="mt-4">
        <p className="mb-3 inline-flex rounded-full bg-leaf-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Presencial &amp; Projetos Especiais
        </p>
        <SectionTitle
          title="Solicitar orcamento"
          subtitle="Conte o que sua propriedade precisa. O escopo, o prazo e o valor são definidos junto com você, sem cobrança automática."
        />
      </div>

      {success && (
        <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800" role="status">
          {success}
        </p>
      )}
      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-8 grid gap-5 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:p-8">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Produtor ou cliente</span>
            <input required value={form.name} onChange={(event) => update("name", event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Telefone</span>
            <input required value={form.phone} onChange={(event) => update("phone", event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">E-mail</span>
            <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Tipo de serviço</span>
            <select
              value={form.serviceType}
              onChange={(event) => update("serviceType", event.target.value)}
              className={inputClass}
            >
              {SERVICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Município</span>
            <input required value={form.city} onChange={(event) => update("city", event.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">UF</span>
            <input
              required
              maxLength={2}
              value={form.state}
              onChange={(event) => update("state", event.target.value.toUpperCase())}
              className={inputClass}
            />
          </label>
        </div>

        {authenticated && properties.length > 0 && (
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Propriedade (opcional)</span>
            <select value={form.propertyId} onChange={(event) => update("propertyId", event.target.value)} className={inputClass}>
              <option value="">Não vincular a uma propriedade</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Descrição da necessidade</span>
          <textarea
            required
            rows={5}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Observações (opcional)</span>
          <textarea rows={3} value={form.notes} onChange={(event) => update("notes", event.target.value)} className={inputClass} />
        </label>

        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
          Nenhuma cobrança e realizada antes da definição e da sua aprovação do orcamento.
        </p>

        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-leaf-700 px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Enviando..." : "Solicitar orcamento"}
        </button>
      </form>
    </section>
  );
}

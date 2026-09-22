"use client";

/**
 * Pareceres tecnicos do assinante.
 *
 * Mostra o saldo do ciclo ("Pareceres utilizados neste ciclo: 1 de 3"), permite
 * abrir uma nova demanda e explica o motivo quando o limite e atingido — com as
 * opcoes de aguardar o proximo ciclo ou solicitar um parecer avulso.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";

type Opinion = {
  id: string;
  title: string;
  status: string;
  origin: "subscription" | "one_time";
  created_at: string;
};

type Balance = {
  limit: number | null;
  used: number;
  remaining: number | null;
  availableCredits: number;
  canOpen: boolean;
  usageLabel: string;
  remainingLabel: string;
  cycleEnd: string;
};

type BlockedOption = { label: string; href: string };

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  em_analise: "Em analise",
  aguardando_informacoes: "Aguardando informacoes",
  respondido: "Respondido",
  concluido: "Concluido",
  cancelado: "Cancelado"
};

const inputClass =
  "mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none transition focus:border-leaf-400 focus:ring-4 focus:ring-leaf-100";

export default function PareceresPage() {
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [blockedOptions, setBlockedOptions] = useState<BlockedOption[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ title: "", description: "" });

  async function load() {
    try {
      const response = await fetch("/api/technical-opinions", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar seus pareceres.");
      setOpinions(payload.opinions ?? []);
      setBalance(payload.balance ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel carregar seus pareceres.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");
    setBlockedOptions([]);

    try {
      const response = await fetch("/api/technical-opinions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setBlockedOptions(Array.isArray(payload?.options) ? payload.options : []);
        throw new Error(payload?.error || "Nao foi possivel abrir a demanda.");
      }

      setMessage(payload?.message || "Demanda aberta.");
      setForm({ title: "", description: "" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel abrir a demanda.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-16">
      <SectionTitle
        title="Pareceres tecnicos"
        subtitle="Cada demanda tecnica consome 1 parecer. Mensagens, fotos, documentos e perguntas complementares da mesma demanda nao consomem pareceres adicionais."
      />

      {balance && (
        <div className="mt-8 grid gap-4 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consumo do ciclo</p>
            <p className="mt-1 text-xl font-black text-leaf-800">{balance.usageLabel}</p>
            <p className="mt-1 text-sm text-slate-600">{balance.remainingLabel}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pareceres avulsos disponiveis</p>
            <p className="mt-1 text-xl font-black text-leaf-800">{balance.availableCredits}</p>
            <p className="mt-1 text-sm text-slate-600">
              O ciclo reinicia em {new Date(balance.cycleEnd).toLocaleDateString("pt-BR")}.
            </p>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {message}
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="alert">
          <p>{error}</p>
          {blockedOptions.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {blockedOptions.map((option) => (
                <Link
                  key={option.href + option.label}
                  href={option.href}
                  className="rounded-full bg-white px-4 py-2 text-center text-sm font-bold text-leaf-700 shadow-sm"
                >
                  {option.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 grid gap-4 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:p-8">
        <h2 className="text-lg font-bold text-slate-950">Abrir nova demanda tecnica</h2>
        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Titulo</span>
          <input
            required
            minLength={3}
            maxLength={200}
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Descricao do problema</span>
          <textarea
            required
            minLength={10}
            rows={5}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="justify-self-start rounded-full bg-leaf-700 px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Abrindo..." : "Abrir demanda tecnica"}
        </button>
      </form>

      <div className="mt-8 grid gap-4">
        {loading && <p className="text-sm text-slate-600">Carregando demandas...</p>}
        {!loading && opinions.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            Voce ainda nao abriu nenhuma demanda tecnica.
          </p>
        )}
        {opinions.map((opinion) => (
          <Link
            key={opinion.id}
            href={`/pareceres/${opinion.id}`}
            className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft transition hover:-translate-y-1 hover:border-leaf-300"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base font-bold text-slate-950">{opinion.title}</p>
              <span className="w-fit rounded-full bg-leaf-50 px-3 py-1 text-xs font-bold text-leaf-700">
                {STATUS_LABELS[opinion.status] ?? opinion.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Aberta em {new Date(opinion.created_at).toLocaleDateString("pt-BR")} ·{" "}
              {opinion.origin === "one_time" ? "Parecer avulso" : "Franquia do plano"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

"use client";

/**
 * Acompanhamento administrativo das solicitações de orcamento
 * (Presencial & Projetos Especiais).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../../components/SectionTitle";
import { getCurrentAuthSession } from "../../../lib/supabaseAuth";

type QuoteRequest = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  city: string;
  state: string;
  service_type: string | null;
  message: string | null;
  notes: string | null;
  status: string;
  internal_notes: string | null;
  created_at: string;
};

const STATUS_OPTIONS = [
  { value: "novo", label: "Novo" },
  { value: "em_contato", label: "Em contato" },
  { value: "confirmado", label: "Confirmado" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" }
];

const SERVICE_LABELS: Record<string, string> = {
  visita_tecnica: "Visita técnica",
  diagnostico_de_campo: "Diagnóstico de campo",
  avaliacao_da_propriedade: "Avaliação da propriedade",
  projeto_personalizado: "Projeto personalizado",
  planejamento_e_acompanhamento: "Planejamento e acompanhamento",
  transicao_organica: "Transição para produção orgânica",
  outro: "Outro projeto presencial"
};

export default function AdminQuotesPage() {
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function authHeaders() {
    const session = await getCurrentAuthSession();
    if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function load() {
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/service-quotes", { headers, cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar as solicitações.");
      setRequests(payload.requests ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as solicitações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    setError("");

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/service-quotes", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ id, status })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível atualizar.");
      setRequests((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-16">
      <Link href="/configuracoes" className="text-sm font-semibold text-leaf-700">
        ← Voltar para Configuracoes
      </Link>

      <div className="mt-4">
        <SectionTitle
          title="Solicitações de orcamento"
          subtitle="Presencial & Projetos Especiais. Nenhuma cobrança automática: o orcamento e definido caso a caso."
        />
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-4">
        {loading && <p className="text-sm text-slate-600">Carregando solicitações...</p>}
        {!loading && requests.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            Nenhuma solicitação de orcamento registrada ainda.
          </p>
        )}

        {requests.map((item) => (
          <article key={item.id} className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-base font-bold text-slate-950">{item.name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {item.city}/{item.state} · {item.phone}
                  {item.email ? ` · ${item.email}` : ""}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-leaf-700">
                  {SERVICE_LABELS[item.service_type ?? ""] ?? item.service_type ?? "Serviço não informado"}
                </p>
              </div>
              <select
                value={item.status}
                disabled={busyId === item.id}
                onChange={(event) => updateStatus(item.id, event.target.value)}
                className="rounded-2xl border border-leaf-100 px-4 py-2 text-sm outline-none focus:border-leaf-400"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {item.message && (
              <p className="mt-4 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {item.message}
              </p>
            )}
            {item.notes && <p className="mt-3 text-sm text-slate-600">Observações: {item.notes}</p>}
            <p className="mt-3 text-xs text-slate-400">
              Recebida em {new Date(item.created_at).toLocaleString("pt-BR")}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

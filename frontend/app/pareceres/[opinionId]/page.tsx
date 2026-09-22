"use client";

/**
 * Detalhe de uma demanda tecnica: historico de mensagens, anexos e novas
 * perguntas. Nada aqui consome um novo parecer.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Opinion = {
  id: string;
  title: string;
  description: string;
  status: string;
  origin: "subscription" | "one_time";
  created_at: string;
};

type Message = {
  id: string;
  author_role: "client" | "specialist" | "admin" | "system";
  body: string;
  attachments: string[];
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  em_analise: "Em analise",
  aguardando_informacoes: "Aguardando informacoes",
  respondido: "Respondido",
  concluido: "Concluido",
  cancelado: "Cancelado"
};

export default function TechnicalOpinionDetailPage() {
  const params = useParams<{ opinionId: string }>();
  const opinionId = params?.opinionId;
  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!opinionId) return;

    try {
      const response = await fetch(`/api/technical-opinions/${opinionId}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Demanda nao encontrada.");
      setOpinion(payload.opinion);
      setMessages(payload.messages ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demanda nao encontrada.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opinionId]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !opinionId) return;

    setSending(true);
    setError("");

    try {
      const response = await fetch(`/api/technical-opinions/${opinionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel enviar a mensagem.");
      setMessages(payload.messages ?? []);
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">Carregando demanda...</section>;
  }

  if (!opinion) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800" role="alert">
          {error || "Demanda nao encontrada."}
        </div>
      </section>
    );
  }

  const closed = opinion.status === "concluido" || opinion.status === "cancelado";

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-16">
      <Link href="/pareceres" className="text-sm font-semibold text-leaf-700">
        ← Voltar para meus pareceres
      </Link>

      <div className="mt-4 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{opinion.title}</h1>
            <p className="mt-2 text-xs text-slate-500">
              Aberta em {new Date(opinion.created_at).toLocaleDateString("pt-BR")} ·{" "}
              {opinion.origin === "one_time" ? "Parecer avulso" : "Franquia do plano"}
            </p>
          </div>
          <span className="w-fit rounded-full bg-leaf-50 px-3 py-1 text-xs font-bold text-leaf-700">
            {STATUS_LABELS[opinion.status] ?? opinion.status}
          </span>
        </div>

        <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          {opinion.description}
        </p>
      </div>

      <div className="mt-6 grid gap-3">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`rounded-3xl border p-5 shadow-soft ${
              message.author_role === "client" ? "border-leaf-100 bg-white" : "border-leaf-200 bg-leaf-50/70"
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">
              {message.author_role === "client" ? "Voce" : message.author_role === "system" ? "Sistema" : "Especialista"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
            {message.attachments.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-leaf-700">
                {message.attachments.map((attachment) => (
                  <li key={attachment}>
                    <a href={attachment} target="_blank" rel="noreferrer" className="underline">
                      Anexo
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">{new Date(message.created_at).toLocaleString("pt-BR")}</p>
          </article>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {closed ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Esta demanda foi encerrada. Para um novo problema, abra uma nova demanda tecnica.
        </p>
      ) : (
        <form onSubmit={send} className="mt-6 grid gap-3 rounded-[2rem] border border-leaf-100 bg-white p-6 shadow-soft">
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Nova mensagem</span>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none transition focus:border-leaf-400 focus:ring-4 focus:ring-leaf-100"
            />
          </label>
          <p className="text-xs text-slate-500">Mensagens desta demanda nao consomem pareceres adicionais.</p>
          <button
            type="submit"
            disabled={sending}
            className="justify-self-start rounded-full bg-leaf-700 px-6 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-60"
          >
            {sending ? "Enviando..." : "Enviar mensagem"}
          </button>
        </form>
      )}
    </section>
  );
}

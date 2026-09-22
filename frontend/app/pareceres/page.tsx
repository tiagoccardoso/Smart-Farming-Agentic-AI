"use client";

/**
 * Pareceres agronômicos humanos do assinante.
 *
 * Mostra o saldo do ciclo calculado no servidor ("Pareceres disponíveis neste
 * mês: 2 de 3") e o histórico. A solicitação de um novo parecer acontece pelo
 * envio de caso (/enviar-caso), que coloca o caso na fila da especialista.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import type { PublicHumanOpinionStatus } from "../../lib/billing/human-opinions";

type Opinion = {
  id: string;
  title: string;
  status: string;
  origin: "subscription" | "one_time";
  case_id: string | null;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  aberto: "Na fila da especialista",
  em_analise: "Em análise",
  aguardando_informacoes: "Aguardando informações",
  respondido: "Respondido",
  concluido: "Concluído",
  cancelado: "Cancelado (não consumiu o benefício)"
};

const SAO_PAULO_DATE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export default function PareceresPage() {
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [status, setStatus] = useState<PublicHumanOpinionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetch("/api/technical-opinions", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar seus pareceres.");
        if (!active) return;
        setOpinions(payload.opinions ?? []);
        setStatus(payload.humanOpinion ?? null);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus pareceres.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-16">
      <SectionTitle
        title="Pareceres agronômicos"
        subtitle="Cada caso enviado para a especialista consome 1 parecer do benefício mensal do seu plano. Mensagens, fotos e documentos do mesmo caso não consomem pareceres adicionais."
      />

      {status && (
        <div
          className={`mt-8 flex flex-col gap-4 rounded-[2rem] border p-6 shadow-soft md:flex-row md:items-center md:justify-between ${
            status.eligible ? "border-leaf-100 bg-white" : "border-amber-200 bg-amber-50"
          }`}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{status.planName}</p>
            <p className="mt-1 text-xl font-black text-leaf-800">
              {status.reason === "plan_without_benefit" ? "Seu plano não inclui parecer agronômico humano" : status.balanceLabel}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{status.message}</p>
            {status.eligible && status.renewsAt && (
              <p className="mt-1 text-xs text-slate-500">
                Renovação do benefício: {SAO_PAULO_DATE.format(new Date(status.renewsAt))}.
              </p>
            )}
          </div>
          <div className="grid shrink-0 gap-2 sm:flex">
            {status.eligible ? (
              <Link
                href="/enviar-caso"
                className="rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft hover:bg-leaf-800"
              >
                Enviar caso para parecer
              </Link>
            ) : (
              status.reason !== "inactive_profile" && (
                <Link
                  href="/planos"
                  className="rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft hover:bg-leaf-800"
                >
                  Ver planos
                </Link>
              )
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-4">
        {loading && <p className="text-sm text-slate-600">Carregando pareceres...</p>}
        {!loading && !error && opinions.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            Você ainda não solicitou nenhum parecer agronômico.
          </p>
        )}
        {opinions.map((opinion) => (
          <Link
            key={opinion.id}
            href={opinion.case_id ? `/revisao-humana?caseId=${encodeURIComponent(opinion.case_id)}` : `/pareceres/${opinion.id}`}
            className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft transition hover:-translate-y-1 hover:border-leaf-300"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base font-bold text-slate-950">{opinion.title}</p>
              <span className="w-fit rounded-full bg-leaf-50 px-3 py-1 text-xs font-bold text-leaf-700">
                {STATUS_LABELS[opinion.status] ?? opinion.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Solicitado em {SAO_PAULO_DATE.format(new Date(opinion.created_at))} ·{" "}
              {opinion.origin === "one_time" ? "Parecer avulso (histórico)" : "Benefício do plano"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

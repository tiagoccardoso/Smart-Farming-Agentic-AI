"use client";

import { useEffect, useMemo, useState } from "react";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type RiskLevel = "low" | "medium" | "high";

type CommercialOpportunity = {
  id: string;
  caseId: string;
  userId: string | null;
  userName: string;
  crop: string;
  risk: RiskLevel | null;
  currentPlan: string;
  caseStatus: string;
  suggestedOffer: string;
  reasons: string[];
  farmName: string;
  createdAt: string | null;
};

type OpportunitiesResponse = {
  opportunities: CommercialOpportunity[];
  generatedAt: string;
};

const riskLabels: Record<RiskLevel, string> = {
  low: "baixo",
  medium: "médio",
  high: "alto"
};

const riskStyles: Record<RiskLevel, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800"
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  ai_analyzed: "Analisado pela IA",
  waiting_human_review: "Aguardando revisão humana",
  human_reviewed: "Revisão humana concluída",
  completed: "Concluído",
  not_requested: "Revisão não contratada",
  pending: "Pendente",
  in_review: "Em revisão",
  completed_review: "Revisão concluída",
  rejected: "Recusado"
};

const offerStyles: Record<string, string> = {
  "Revisão humana R$ 197": "bg-leaf-50 text-leaf-800 ring-leaf-100",
  "Interpretação de análise de solo R$ 250": "bg-sky-50 text-sky-800 ring-sky-100",
  "Relatório técnico R$ 500": "bg-amber-50 text-amber-800 ring-amber-100",
  "Acompanhamento mensal R$ 997+": "bg-purple-50 text-purple-800 ring-purple-100"
};

function parseResponse(response: Response) {
  return response.json().catch(() => null).then((payload) => {
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || "A solicitação não pôde ser concluída.");
    }

    return payload;
  });
}

async function getOpportunities(accessToken: string) {
  const response = await fetch("/api/admin/opportunities", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseResponse(response) as Promise<OpportunitiesResponse>;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Não informada";
  }

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function getStatusLabel(status?: string | null) {
  if (!status) {
    return "Sem status";
  }

  return statusLabels[status] ?? status;
}

function getRiskBadge(risk: RiskLevel | null) {
  if (!risk) {
    return <span className="rounded-full border border-[#e7e2d9] bg-[#f8f3ea] px-3 py-1 text-xs font-semibold text-[#414943]">Sem risco</span>;
  }

  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskStyles[risk]}`}>Risco {riskLabels[risk]}</span>;
}

export default function AdminOpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<CommercialOpportunity[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOpportunities() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);

      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      try {
        const response = await getOpportunities(accessToken);
        setOpportunities(response.opportunities);
        setGeneratedAt(response.generatedAt);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Não foi possível carregar oportunidades comerciais.";

        if (message.toLowerCase().includes("acesso negado")) {
          setAccessDenied(true);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    }

    loadOpportunities();
  }, []);

  const metrics = useMemo(
    () => [
      {
        label: "Oportunidades",
        value: String(opportunities.length),
        color: "text-leaf-700"
      },
      {
        label: "Risco médio/alto",
        value: String(opportunities.filter((item) => item.risk === "medium" || item.risk === "high").length),
        color: "text-amber-700"
      },
      {
        label: "Acompanhamento mensal",
        value: String(opportunities.filter((item) => item.suggestedOffer.includes("Acompanhamento mensal")).length),
        color: "text-purple-700"
      }
    ],
    [opportunities]
  );

  return (
    <section className="mx-auto max-w-7xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Comercial · sem disparos automáticos
        </p>
        <SectionTitle title="Painel de oportunidades" subtitle="Acompanhe casos com potencial de upsell para revisão humana, relatório técnico e acompanhamento mensal." />
        <p className="max-w-3xl text-base leading-7 text-[#414943]">
          Esta página apenas organiza sinais comerciais. Nenhuma mensagem é enviada automaticamente para os usuários.
        </p>
      </div>

      {accessDenied ? (
        <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700 shadow-soft">
          Faça login com uma conta administradora para visualizar oportunidades comerciais.
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
                <p className="text-sm font-semibold uppercase tracking-wide text-[#717973]">{metric.label}</p>
                <p className={`mt-3 text-4xl font-bold ${metric.color}`}>{metric.value}</p>
              </article>
            ))}
          </div>

          {generatedAt && <p className="mt-4 text-xs text-[#717973]">Atualizado em {formatDate(generatedAt)}.</p>}

          {error && <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-5 text-sm text-red-700 shadow-soft">{error}</div>}

          {loading && <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 text-sm text-[#414943] shadow-soft">Carregando oportunidades comerciais...</div>}

          {!loading && opportunities.length === 0 && !error && (
            <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-8 text-center shadow-soft">
              <h2 className="text-xl font-semibold text-[#1d1c16]">Nenhuma oportunidade encontrada</h2>
              <p className="mt-2 text-sm leading-6 text-[#414943]">Quando houver casos com risco, plano gratuito, limite atingido, recorrência ou sem revisão humana, eles aparecerão aqui.</p>
            </div>
          )}

          {opportunities.length > 0 && (
            <div className="mt-8 overflow-hidden rounded-3xl border border-leaf-100 bg-white shadow-soft">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                  <thead className="bg-[#f8f3ea] text-xs uppercase tracking-wide text-[#717973]">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Usuário</th>
                      <th className="px-5 py-4 font-semibold">Cultura</th>
                      <th className="px-5 py-4 font-semibold">Risco</th>
                      <th className="px-5 py-4 font-semibold">Plano atual</th>
                      <th className="px-5 py-4 font-semibold">Status do caso</th>
                      <th className="px-5 py-4 font-semibold">Sugestão de oferta</th>
                      <th className="px-5 py-4 font-semibold">Motivos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {opportunities.map((opportunity) => (
                      <tr key={opportunity.id} className="align-top hover:bg-leaf-50/40">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-[#1d1c16]">{opportunity.userName}</p>
                          <p className="mt-1 text-xs text-[#717973]">{opportunity.farmName}</p>
                          <p className="mt-1 text-xs text-[#717973]">Caso {opportunity.caseId.slice(0, 8)} · {formatDate(opportunity.createdAt)}</p>
                        </td>
                        <td className="px-5 py-4 font-medium text-[#1d1c16]">{opportunity.crop}</td>
                        <td className="px-5 py-4">{getRiskBadge(opportunity.risk)}</td>
                        <td className="px-5 py-4 text-[#414943]">{opportunity.currentPlan}</td>
                        <td className="px-5 py-4 text-[#414943]">{getStatusLabel(opportunity.caseStatus)}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${offerStyles[opportunity.suggestedOffer] ?? "bg-[#f8f3ea] text-[#414943] ring-[#e7e2d9]"}`}>
                            {opportunity.suggestedOffer}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex max-w-sm flex-wrap gap-2">
                            {opportunity.reasons.map((reason) => (
                              <span key={reason} className="rounded-full bg-[#f2ede4] px-3 py-1 text-xs font-semibold text-[#414943]">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

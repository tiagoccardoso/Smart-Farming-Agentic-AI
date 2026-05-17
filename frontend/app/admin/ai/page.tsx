"use client";

import { useEffect, useMemo, useState } from "react";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type AIHealth = {
  provider: string;
  configured: boolean;
  ok: boolean;
  model?: string;
  message?: string;
};

type AIUsageLog = {
  id: string;
  provider: string;
  model: string;
  prompt_type: string;
  tokens_input: number | null;
  tokens_output: number | null;
  estimated_cost: number | null;
  response_time_ms: number | null;
  success: boolean | null;
  fallback_used: boolean | null;
  created_at: string;
};

type AIUsageResponse = {
  activeProvider: string;
  activeModel: string;
  totalCalls: number;
  estimatedCost: number;
  tokensInput: number;
  tokensOutput: number;
  failures: number;
  fallbackCount: number;
  averageResponseTimeMs: number;
  health: AIHealth[];
  recentLogs: AIUsageLog[];
  generatedAt: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Não foi possível carregar dados de IA.");
  }
  return payload as AIUsageResponse;
}

async function getAIUsage(accessToken: string) {
  const response = await fetch("/api/admin/ai-usage", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  return parseResponse(response);
}

export default function AdminAIPage() {
  const [data, setData] = useState<AIUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      const token = getStoredSupabaseAccessToken();

      if (!token) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      try {
        setData(await getAIUsage(token));
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Não foi possível carregar monitoramento de IA.";
        if (message.toLowerCase().includes("acesso negado")) {
          setAccessDenied(true);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const metrics = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      { label: "Provider ativo", value: data.activeProvider, detail: data.activeModel },
      { label: "Chamadas", value: String(data.totalCalls), detail: "últimos 500 logs" },
      { label: "Custo estimado", value: formatCurrency(data.estimatedCost), detail: "estimativa operacional" },
      { label: "Tokens", value: String(data.tokensInput + data.tokensOutput), detail: `${data.tokensInput} entrada · ${data.tokensOutput} saída` },
      { label: "Falhas", value: String(data.failures), detail: "respostas com erro" },
      { label: "Fallback", value: String(data.fallbackCount), detail: "Gemini/local acionado" },
      { label: "Tempo médio", value: `${data.averageResponseTimeMs}ms`, detail: "respostas bem-sucedidas" }
    ];
  }, [data]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          IA agronômica · monitoramento server-side
        </p>
        <SectionTitle title="Monitoramento da IA" subtitle="Acompanhe OpenAI como cérebro principal, Gemini como fallback e uso operacional da plataforma." />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Este painel não expõe chaves de API e mostra apenas métricas consolidadas e logs técnicos recentes para administradores.
        </p>
      </div>

      {accessDenied && <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700 shadow-soft">Faça login com uma conta administradora para visualizar o monitoramento de IA.</div>}
      {error && <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-6 text-sm text-red-700 shadow-soft">{error}</div>}
      {loading && <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 text-sm text-slate-600 shadow-soft">Carregando métricas de IA...</div>}

      {data && !loading && (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
                <p className="mt-3 break-words text-3xl font-bold text-slate-900">{metric.value}</p>
                <p className="mt-2 text-sm text-slate-500">{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {data.health.map((item) => (
              <article key={item.provider} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900">{item.provider}</h2>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {item.configured ? "Configurado" : "Pendente"}
                  </span>
                </div>
                <p className="mt-4 text-sm text-slate-600">Modelo: {item.model || "não informado"}</p>
                <p className="mt-1 text-sm text-slate-600">{item.message}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-leaf-100 bg-white shadow-soft">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-xl font-semibold text-slate-900">Logs recentes</h2>
              <p className="mt-1 text-sm text-slate-500">Atualizado em {formatDate(data.generatedAt)}.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-4 font-semibold">Data</th>
                    <th className="px-5 py-4 font-semibold">Provider</th>
                    <th className="px-5 py-4 font-semibold">Modelo</th>
                    <th className="px-5 py-4 font-semibold">Tipo</th>
                    <th className="px-5 py-4 font-semibold">Tokens</th>
                    <th className="px-5 py-4 font-semibold">Custo</th>
                    <th className="px-5 py-4 font-semibold">Tempo</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentLogs.map((log) => (
                    <tr key={log.id} className="align-top">
                      <td className="px-5 py-4 text-slate-600">{formatDate(log.created_at)}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{log.provider}</td>
                      <td className="px-5 py-4 text-slate-600">{log.model}</td>
                      <td className="px-5 py-4 text-slate-600">{log.prompt_type}</td>
                      <td className="px-5 py-4 text-slate-600">{Number(log.tokens_input ?? 0) + Number(log.tokens_output ?? 0)}</td>
                      <td className="px-5 py-4 text-slate-600">{formatCurrency(Number(log.estimated_cost ?? 0))}</td>
                      <td className="px-5 py-4 text-slate-600">{log.response_time_ms ?? 0}ms</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${log.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                          {log.success ? "Sucesso" : "Falha"}{log.fallback_used ? " · fallback" : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

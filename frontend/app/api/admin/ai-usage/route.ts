import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../lib/agronomic/case";
import { getFallbackProvider, getPrimaryProvider } from "../../../../src/lib/ai/providers";

type AdminProfile = {
  role: "client" | "specialist" | "admin";
};

type UsageLogRow = {
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

function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para monitorar IA.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey };
}

async function supabaseAdminRequest<T>(path: string, init: RequestInit, config = getSupabaseAdminConfig()) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    cache: "no-store"
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Erro ao consultar Supabase.");
  }

  return payload as T;
}

async function getAdminProfile(token: string, userId: string) {
  const profiles = await supabaseRequest<AdminProfile[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`, { method: "GET" }, token);
  return profiles[0] ?? null;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login como administrador para monitorar IA." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const profile = await getAdminProfile(token, user.id);

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Acesso negado: apenas administradores podem monitorar IA." }, { status: 403 });
    }

    const [logs, primaryHealth, fallbackHealth] = await Promise.all([
      supabaseAdminRequest<UsageLogRow[]>("/rest/v1/ai_usage_logs?select=id,provider,model,prompt_type,tokens_input,tokens_output,estimated_cost,response_time_ms,success,fallback_used,created_at&order=created_at.desc&limit=500", { method: "GET" }),
      getPrimaryProvider().healthCheck(),
      getFallbackProvider().healthCheck()
    ]);

    const totalCalls = logs.length;
    const totalCost = logs.reduce((total, log) => total + Number(log.estimated_cost ?? 0), 0);
    const tokensInput = logs.reduce((total, log) => total + Number(log.tokens_input ?? 0), 0);
    const tokensOutput = logs.reduce((total, log) => total + Number(log.tokens_output ?? 0), 0);
    const failures = logs.filter((log) => log.success === false).length;
    const fallbackCount = logs.filter((log) => log.fallback_used).length;
    const latest = logs[0] ?? null;

    return NextResponse.json({
      activeProvider: primaryHealth.configured ? primaryHealth.provider : fallbackHealth.provider,
      activeModel: latest?.model || primaryHealth.model || fallbackHealth.model || "não configurado",
      totalCalls,
      estimatedCost: Number(totalCost.toFixed(6)),
      tokensInput,
      tokensOutput,
      failures,
      fallbackCount,
      averageResponseTimeMs: average(logs.map((log) => Number(log.response_time_ms ?? 0)).filter((value) => value > 0)),
      health: [primaryHealth, fallbackHealth],
      recentLogs: logs.slice(0, 25),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar monitoramento de IA.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

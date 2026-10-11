/**
 * Regressão da falha do caso de tomate (código de suporte 91689349683-d734721b2e8a).
 *
 * Logs de produção (deploy 4af7264, request jm6wl-1791689349683-d734721b2e8a):
 *   03:29:10.767 jobs_unavailable_sync_fallback   (tabela de jobs ausente)
 *   03:29:46.792 Provider principal (openai) falhou { category: AI_TIMEOUT, images: 1 }
 *   03:29:46.792 Fallback (gemini) não executado por falta de tempo
 *   03:29:47.115 model_failed { code: AI_TIMEOUT, durationMs: 37328 }
 * Três tentativas, todas com 37,3 s: ~1,1 s de preparo + 12 s de pesquisa
 * (teto) + ~24 s concedidos à OpenAI (12 s ficavam guardados para o Gemini) e
 * depois sobravam 11,7 s, abaixo do mínimo de 12 s, para o fallback. Ou seja,
 * o próprio orçamento cortava a chamada principal.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_BUDGET_MS,
  ANALYSIS_MIN_PROVIDER_MS,
  ANALYSIS_PRIMARY_TARGET_MS,
  ANALYSIS_SAVE_RESERVE_MS,
  ANALYSIS_SYNC_RESEARCH_CAP_MS,
  AgronomicAnalysisError,
  classifyProviderFailure,
  providerTimeoutMs,
  researchBudgetMs,
} from "../lib/agronomic/case-analysis";
import { analyzeAgronomicCase, type AgronomicAnalysisRunInfo } from "../src/lib/ai/orchestrator/analyze-case";
import { AnalysisJobStoreUnavailableError, createSupabaseAnalysisJobStore } from "../lib/server/analysis-jobs";
import type { AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult, InternetResearchResult } from "../src/lib/ai/providers/types";

const VALID_ANALYSIS = {
  initialDiagnosis: "Lesões compatíveis com pinta-preta.",
  probableHypotheses: ["Pinta-preta"],
  visualFindings: ["Manchas escuras com anéis na foto 1."],
  possibleCauses: ["Umidade alta"],
  missingQuestions: [],
  riskLevel: "medium",
  confidenceLevel: "medium",
  productionImpact: "Perda de área foliar.",
  attentionPoints: ["Monitorar"],
  initialRecommendation: "Confirmar em campo.",
  safeInitialRecommendations: ["Remover folhas afetadas"],
  whenToCallHumanSpecialist: "Se avançar.",
  humanReviewReason: "Confirmação visual.",
};

type Call = { messages: AIMessage[]; options: AIProviderCallOptions; at: number };

class FakeProvider implements AIProvider {
  calls: Call[] = [];
  constructor(readonly name: "openai" | "gemini", private behavior: (call: Call) => Promise<unknown> | unknown) {}
  async generateText(): Promise<AIProviderResult<string>> {
    throw new Error("não usado");
  }
  async generateStructuredOutput<T>(messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<T>> {
    const call = { messages, options, at: Date.now() };
    this.calls.push(call);
    const content = (await this.behavior(call)) as T;
    return { provider: this.name, model: options.model ?? "fake", content, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, responseTimeMs: 1 };
  }
  async generateEmbeddings(): Promise<AIProviderResult<number[][]>> {
    throw new Error("não usado");
  }
  async analyzeImages(): Promise<AIProviderResult<string>> {
    throw new Error("não usado");
  }
  async healthCheck() {
    return { provider: this.name, configured: true, ok: true };
  }
}

const noResearch = {
  searchKnowledge: async () => [],
  searchInternet: async (): Promise<InternetResearchResult> => ({ status: "unavailable", query: "q", summary: "sem pesquisa", sources: [] }),
};

const tomato = {
  id: "case-tomate",
  user_id: "user-owner",
  crop: "Tomate",
  symptoms: "Manchas escuras nas folhas velhas",
  history: null,
  growth_stage: "frutificação",
  soil_analysis_url: null,
  farm: { city: "Campinas", state: "SP" },
  images: [],
};

test("linha do tempo de produção: o principal recebe a janela inteira, não ~24 s", () => {
  const start = 1_000_000;
  const deadlineAt = start + ANALYSIS_BUDGET_MS;
  const researchEnd = start + 1_100 + 12_000; // pesquisa esgotando o teto antigo
  const primary = providerTimeoutMs({ deadlineAt, hasFallback: true, defaultMs: 60_000, now: researchEnd });
  // Antes: 54 000 - 13 100 - 5 000 - 12 000 = 23 900 ms.
  assert.equal(primary, ANALYSIS_BUDGET_MS - 13_100 - ANALYSIS_SAVE_RESERVE_MS);
  assert.ok(primary > 30_000);
  assert.ok(researchEnd + primary + ANALYSIS_SAVE_RESERVE_MS <= deadlineAt);
});

test("o fluxo síncrono usa teto menor de pesquisa e deixa ~40 s para a IA", () => {
  const start = 1_000_000;
  const deadlineAt = start + ANALYSIS_BUDGET_MS;
  const research = researchBudgetMs(deadlineAt, start + 1_100, ANALYSIS_SYNC_RESEARCH_CAP_MS);
  assert.equal(research, ANALYSIS_SYNC_RESEARCH_CAP_MS);
  const primary = providerTimeoutMs({ deadlineAt, hasFallback: true, defaultMs: 60_000, now: start + 1_100 + research });
  assert.equal(primary, ANALYSIS_BUDGET_MS - 1_100 - ANALYSIS_SYNC_RESEARCH_CAP_MS - ANALYSIS_SAVE_RESERVE_MS);
  assert.ok(primary >= 39_000);
});

test("com orçamento folgado, a janela do fallback continua reservada", () => {
  const now = 0;
  const deadlineAt = ANALYSIS_PRIMARY_TARGET_MS + ANALYSIS_MIN_PROVIDER_MS + ANALYSIS_SAVE_RESERVE_MS + 10_000;
  const primary = providerTimeoutMs({ deadlineAt, hasFallback: true, defaultMs: 120_000, now });
  assert.equal(primary, deadlineAt - ANALYSIS_SAVE_RESERVE_MS - ANALYSIS_MIN_PROVIDER_MS);
});

test("análise que leva mais de 24 s cabe no orçamento (antes era abortada)", async () => {
  const deadlineAt = Date.now() + ANALYSIS_BUDGET_MS;
  const runInfo: AgronomicAnalysisRunInfo = { images: null };
  const primary = new FakeProvider("openai", (call) => {
    // O provedor real precisaria de ~30 s; aqui basta conferir a janela concedida.
    assert.ok((call.options.timeoutMs ?? 0) >= 30_000, `janela concedida: ${call.options.timeoutMs}`);
    return VALID_ANALYSIS;
  });
  const fallback = new FakeProvider("gemini", () => VALID_ANALYSIS);
  const analysis = await analyzeAgronomicCase(
    tomato,
    {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt,
      researchCapMs: ANALYSIS_SYNC_RESEARCH_CAP_MS,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: fallback, model: "gemini" } }) },
    },
    runInfo,
  );
  assert.match(analysis.initialDiagnosis, /pinta-preta/i);
  assert.equal(fallback.calls.length, 0);
  assert.deepEqual(runInfo.attempts?.map((attempt) => attempt.outcome), ["success"]);
  assert.equal(runInfo.researchBudgetMs, ANALYSIS_SYNC_RESEARCH_CAP_MS);
});

test("pesquisa travada respeita o teto síncrono e não come o tempo da IA", async () => {
  const startedAt = Date.now();
  const primary = new FakeProvider("openai", () => VALID_ANALYSIS);
  // Teto curto só para o teste não esperar 8 s.
  await analyzeAgronomicCase(tomato, {
    logUsage: false,
    allowLocalFallback: false,
    deadlineAt: startedAt + ANALYSIS_BUDGET_MS,
    researchCapMs: 300,
    deps: {
      searchKnowledge: () => new Promise(() => undefined),
      searchInternet: () => new Promise(() => undefined),
      selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }),
    },
  });
  assert.ok(primary.calls[0].at - startedAt < 1_500);
  assert.ok((primary.calls[0].options.timeoutMs ?? 0) >= ANALYSIS_BUDGET_MS - 1_500 - ANALYSIS_SAVE_RESERVE_MS);
});

test("falha rápida do principal (503) ainda aciona o fallback e registra as tentativas", async () => {
  const runInfo: AgronomicAnalysisRunInfo = { images: null };
  const primary = new FakeProvider("openai", () => {
    throw Object.assign(new Error("Service Unavailable"), { status: 503 });
  });
  const fallback = new FakeProvider("gemini", () => VALID_ANALYSIS);
  await analyzeAgronomicCase(
    tomato,
    {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + ANALYSIS_BUDGET_MS,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: fallback, model: "gemini" } }) },
    },
    runInfo,
  );
  assert.equal(fallback.calls.length, 1);
  assert.deepEqual(runInfo.attempts?.map((attempt) => [attempt.provider, attempt.outcome]), [
    ["openai", "AI_UNAVAILABLE"],
    ["gemini", "success"],
  ]);
});

test("timeout do principal sem tempo para o fallback: AI_TIMEOUT e tentativa registrada", async () => {
  const runInfo: AgronomicAnalysisRunInfo = { images: null };
  // Deadline curto: o principal recebe a janela restante e expira.
  const deadlineAt = Date.now() + ANALYSIS_MIN_PROVIDER_MS + ANALYSIS_SAVE_RESERVE_MS + 500;
  const primary = new FakeProvider("openai", async () => {
    // Consome parte da janela antes de expirar: não sobram 12 s úteis.
    await new Promise((resolve) => setTimeout(resolve, 800));
    throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  });
  const fallback = new FakeProvider("gemini", () => VALID_ANALYSIS);
  await assert.rejects(
    analyzeAgronomicCase(
      tomato,
      {
        logUsage: false,
        allowLocalFallback: false,
        deadlineAt,
        deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: fallback, model: "gemini" } }) },
      },
      runInfo,
    ),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_TIMEOUT",
  );
  assert.deepEqual(runInfo.attempts?.map((attempt) => attempt.outcome), ["AI_TIMEOUT", "skipped_no_time"]);
  assert.equal(fallback.calls.length, 0);
});

test("resposta inválida do provedor vira AI_INVALID_RESPONSE, não timeout", async () => {
  const primary = new FakeProvider("openai", () => {
    throw new Error("Unexpected token < in JSON at position 0");
  });
  await assert.rejects(
    analyzeAgronomicCase(tomato, {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + ANALYSIS_BUDGET_MS,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }) },
    }),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_INVALID_RESPONSE" && error.status === 502,
  );
});

test("classificação usa o status HTTP antes do texto da mensagem", () => {
  assert.equal(classifyProviderFailure(Object.assign(new Error("Rate limit: invalid json body"), { status: 429 })), "AI_UNAVAILABLE");
  assert.equal(classifyProviderFailure(Object.assign(new Error("request timeout"), { status: 400 })), "AI_UNAVAILABLE");
  assert.equal(classifyProviderFailure(Object.assign(new Error("x"), { status: 408 })), "AI_TIMEOUT");
  assert.equal(classifyProviderFailure(Object.assign(new Error("Tempo limite ao falar com a OpenAI."), { status: 0 })), "AI_TIMEOUT");
  assert.equal(classifyProviderFailure(new AgronomicAnalysisError("SAVE_FAILED")), "SAVE_FAILED");
  assert.equal(classifyProviderFailure(new AgronomicAnalysisError("AI_TIMEOUT")), "AI_TIMEOUT");
});

test("tabela de jobs ausente informa motivo e código (diagnóstico do fallback síncrono)", async () => {
  const store = createSupabaseAnalysisJobStore({
    supabaseUrl: "https://projeto.supabase.co",
    serviceRoleKey: "service-role-de-teste",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.agronomic_analysis_jobs' in the schema cache" }), {
        status: 404,
      })) as unknown as typeof fetch,
  });
  await assert.rejects(store.latestForCase("case-tomate"), (error: unknown) => {
    assert.ok(error instanceof AnalysisJobStoreUnavailableError);
    assert.equal(error.reason, "table_missing");
    assert.equal(error.dbCode, "PGRST205");
    return true;
  });
  const unconfigured = createSupabaseAnalysisJobStore({ supabaseUrl: "https://projeto.supabase.co", serviceRoleKey: "" });
  await assert.rejects(unconfigured.latestForCase("x"), (error: unknown) => error instanceof AnalysisJobStoreUnavailableError && error.reason === "missing_config");
});

test("resposta inválida do principal não vira 'indisponível' por causa do fallback", async () => {
  const primary = new FakeProvider("openai", () => {
    throw new Error("Unexpected token < in JSON at position 0");
  });
  const unconfigured = new FakeProvider("gemini", () => {
    throw new Error("Configure GEMINI_API_KEY para usar o Gemini.");
  });
  await assert.rejects(
    analyzeAgronomicCase(tomato, {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + ANALYSIS_BUDGET_MS,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: unconfigured, model: "gemini" } }) },
    }),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_INVALID_RESPONSE",
  );
});

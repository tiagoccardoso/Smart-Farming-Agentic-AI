/**
 * Análise inicial em processamento durável (agronomic_analysis_jobs + modo
 * background do provedor).
 *
 * Causa raiz (código de suporte 91663441331-b1886142b05d, 10/10 20:17 UTC):
 * a requisição durou 37,3 s; a OpenAI não respondeu dentro da janela de
 * ~32 s que sobrava no limite de 60 s da rota (`maxDuration = 60`) e o
 * fallback Gemini não coube no tempo restante. A geração da análise (JSON
 * longo, com fotos) leva mais que uma requisição síncrona permite.
 *
 * Estes testes cobrem: início rápido com job persistido, acompanhamento,
 * gravação única do resultado (mesmo com consultas simultâneas ou tardias),
 * falhas de provedor/gravação, clique duplo, isolamento entre usuários e o
 * fluxo apenas com texto.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AgronomicAnalysisError,
  JOB_MAX_PROCESSING_MS,
  JOB_START_STALE_MS,
  loadAnalysisImages,
  type AnalysisImagesResult,
} from "../lib/agronomic/case-analysis";
import { AnalysisJobStoreUnavailableError, createSupabaseAnalysisJobStore } from "../lib/server/analysis-jobs";
import { pollCaseAnalysis, startCaseAnalysis, type AnalysisServiceDeps } from "../lib/server/case-analysis-service";
import {
  ANALYSIS_MAX_OUTPUT_TOKENS,
  completeAgronomicAnalysis,
  prepareAgronomicAnalysis,
  selectBackgroundAnalysisModel,
} from "../src/lib/ai/orchestrator/analyze-case";
import type { AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult, InternetResearchResult } from "../src/lib/ai/providers/types";
import { FakeBackground, FakeClock, MemoryJobStore } from "./helpers/analysis-job-fakes";

const OWNER = "user-owner";
const OTHER = "user-intruso";
const CASE_ID = "case-tomate";
const PREFIX = "https://projeto.supabase.co/storage/v1/object/public/agronomic-cases/";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

const caseData = (images: Array<{ image_url: string; image_type?: string }> = []) => ({
  id: CASE_ID,
  user_id: OWNER,
  crop: "Tomate",
  symptoms: "Manchas escuras nas folhas velhas",
  history: null,
  growth_stage: "frutificação",
  soil_analysis_url: null,
  farm: { city: "Campinas", state: "SP" },
  images,
});

const MODEL_JSON = JSON.stringify({
  initialDiagnosis: "Lesões compatíveis com pinta-preta.",
  probableHypotheses: ["Pinta-preta"],
  visualFindings: ["Anéis concêntricos na foto 1"],
  possibleCauses: ["Umidade"],
  missingQuestions: ["Qual a área afetada?"],
  riskLevel: "medium",
  confidenceLevel: "medium",
  productionImpact: "Moderado",
  attentionPoints: ["Avanço para o terço médio"],
  initialRecommendation: "Inspecionar o talhão",
  safeInitialRecommendations: ["Inspecionar"],
  whenToCallHumanSpecialist: "Se avançar",
  humanReviewReason: "Confirmação",
});

const noResearch = {
  searchKnowledge: async () => [],
  searchInternet: async (): Promise<InternetResearchResult> => ({ status: "unavailable", query: "q", summary: "sem pesquisa", sources: [] }),
};

function loaded(count: number): AnalysisImagesResult {
  return {
    total: count,
    skipped: 0,
    unavailable: [],
    loaded: Array.from({ length: count }, (_, index) => ({
      url: `${PREFIX}${OWNER}/${CASE_ID}/f${index}.jpg`,
      label: `foto ${index + 1} do caso`,
      input: { base64: JPEG.toString("base64"), mimeType: "image/jpeg" },
    })),
  };
}

function setup(options: { images?: number; persist?: () => Promise<unknown> } = {}) {
  const clock = new FakeClock();
  const store = new MemoryJobStore(clock);
  const background = new FakeBackground();
  const persisted: unknown[] = [];
  const usage: unknown[] = [];
  const events: string[] = [];
  const data = caseData(Array.from({ length: options.images ?? 0 }, (_, index) => ({ image_url: `${PREFIX}${OWNER}/${CASE_ID}/f${index}.jpg` })));
  const deps: AnalysisServiceDeps = {
    store,
    background,
    complete: (content, context) => completeAgronomicAnalysis(content, context, data),
    persist: options.persist ?? (async (analysis) => {
      persisted.push(analysis);
    }),
    logUsage: async (entry) => {
      usage.push(entry);
    },
    log: (event) => {
      events.push(event);
    },
    now: clock.now,
  };
  const start = (overrides: Partial<Parameters<typeof startCaseAnalysis>[0]> = {}) =>
    startCaseAnalysis({
      caseId: CASE_ID,
      userId: OWNER,
      requestId: "req-1",
      deadlineAt: clock.now() + 54_000,
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      selectModel: selectBackgroundAnalysisModel,
      prepare: () =>
        prepareAgronomicAnalysis(data, {
          // Pesquisa/fotos usam o relógio real (teto de tempo de verdade).
          deadlineAt: Date.now() + 54_000,
          imageDetail: "high",
          prepareImages: async () => loaded(options.images ?? 0),
          deps: noResearch,
        }),
      deps,
      ...overrides,
    });
  const poll = (userId = OWNER) => pollCaseAnalysis({ caseId: CASE_ID, userId, deps });
  return { clock, store, background, persisted, usage, events, deps, start, poll, data };
}

const userMessage = (messages: unknown[]) => (messages as AIMessage[]).find((message) => message.role === "user")!;

test("início rápido: registra o job, envia as fotos em alta resolução e responde 'processing'", async () => {
  const t = setup({ images: 2 });
  const view = await t.start();
  assert.equal(view.state, "processing");
  assert.equal(t.background.started.length, 1);
  const message = userMessage(t.background.started[0].messages);
  assert.equal(message.images?.length, 2);
  assert.ok(message.images?.every((image) => image.detail === "high"));
  const job = t.store.jobs[0];
  assert.equal(job.provider_response_id, "resp_1");
  assert.equal(job.request_id, "req-1");
  assert.deepEqual((job.image_summary as { analyzed: number }).analyzed, 2);
  assert.ok(job.context, "o contexto da pesquisa fica salvo para normalizar o resultado depois");
  assert.ok(!JSON.stringify(job.image_summary).includes("http"), "o resumo salvo não contém URLs");
});

test("fluxo só com texto continua funcionando", async () => {
  const t = setup();
  await t.start();
  assert.equal(userMessage(t.background.started[0].messages).images, undefined);
  t.background.finish("resp_1", MODEL_JSON);
  const view = await t.poll();
  assert.equal(view.state, "completed");
  assert.equal(t.persisted.length, 1);
});

test("acompanha enquanto processa e grava UMA vez quando fica pronto", async () => {
  const t = setup({ images: 1 });
  await t.start();
  assert.equal((await t.poll()).state, "processing");
  t.background.responses.set("resp_1", { status: "in_progress" });
  assert.equal((await t.poll()).state, "processing");
  t.background.finish("resp_1", MODEL_JSON);
  const done = await t.poll();
  assert.equal(done.state, "completed");
  assert.equal(t.persisted.length, 1);
  assert.match((t.persisted[0] as { initialDiagnosis: string }).initialDiagnosis, /pinta-preta/);
  assert.equal((t.persisted[0] as { imageAnalysis: { analyzed: number } }).imageAnalysis.analyzed, 1);
  assert.equal(t.usage.length, 1);
  // Consultas seguintes só leem o estado; nada é gravado de novo.
  assert.equal((await t.poll()).state, "completed");
  assert.equal(t.persisted.length, 1);
});

test("consultas simultâneas com o resultado pronto gravam uma única vez", async () => {
  const t = setup();
  await t.start();
  t.background.finish("resp_1", MODEL_JSON);
  const views = await Promise.all([t.poll(), t.poll(), t.poll()]);
  assert.equal(t.persisted.length, 1);
  assert.ok(views.some((view) => view.state === "completed"));
  assert.ok(views.every((view) => view.state === "completed" || view.state === "saving"));
});

test("resposta tardia: concluída depois que a tela parou de esperar não se perde", async () => {
  const t = setup({ images: 1 });
  await t.start();
  // Usuário saiu da tela; ninguém consulta por 5 minutos.
  t.clock.advance(5 * 60_000);
  t.background.finish("resp_1", MODEL_JSON);
  // Ao reabrir o caso, a primeira consulta grava o resultado.
  const view = await t.poll();
  assert.equal(view.state, "completed");
  assert.equal(t.persisted.length, 1);
});

test("clique duplo e novas tentativas durante o processamento não iniciam outra análise", async () => {
  const t = setup();
  const [a, b] = await Promise.all([t.start(), t.start()]);
  assert.equal(t.background.started.length, 1, "uma única chamada paga ao provedor");
  assert.equal(t.store.jobs.length, 1);
  assert.ok([a, b].some((view) => "reused" in view && view.reused));
  const again = await t.start();
  assert.equal(again.state, "processing");
  assert.ok("reused" in again && again.reused);
  assert.equal(t.background.started.length, 1);
});

test("nova tentativa depois de concluída inicia nova análise normalmente", async () => {
  const t = setup();
  await t.start();
  t.background.finish("resp_1", MODEL_JSON);
  await t.poll();
  const view = await t.start({ requestId: "req-2" });
  assert.equal(view.state, "processing");
  assert.equal(t.background.started.length, 2);
});

test("falha ao gravar: tenta de novo nas próximas consultas e só então desiste", async () => {
  let failures = 0;
  const t = setup({
    persist: async () => {
      failures += 1;
      if (failures <= 1) throw new Error("PATCH agronomic_cases falhou");
    },
  });
  await t.start();
  t.background.finish("resp_1", MODEL_JSON);
  const first = await t.poll();
  assert.equal(first.state, "processing", "a resposta continua no provedor; não é dada como concluída");
  assert.equal(t.store.jobs[0].save_attempts, 1);
  const second = await t.poll();
  assert.equal(second.state, "completed");

  let always = 0;
  const t2 = setup({
    persist: async () => {
      always += 1;
      throw new Error("banco fora do ar");
    },
  });
  await t2.start();
  t2.background.finish("resp_1", MODEL_JSON);
  await t2.poll();
  await t2.poll();
  const last = await t2.poll();
  assert.equal(last.state, "failed");
  assert.equal(last.state === "failed" && last.code, "SAVE_FAILED");
  assert.equal(always, 3);
});

test("falha, cancelamento ou saída incompleta do provedor viram erro tipado e permitem nova tentativa", async () => {
  const t = setup();
  await t.start();
  t.background.responses.set("resp_1", { status: "failed", reason: "server_error" });
  const failed = await t.poll();
  assert.equal(failed.state, "failed");
  assert.equal(failed.state === "failed" && failed.code, "AI_UNAVAILABLE");
  assert.equal(failed.state === "failed" && failed.retryable, true);

  const t2 = setup();
  await t2.start();
  t2.background.responses.set("resp_1", { status: "incomplete", reason: "max_output_tokens" });
  const incomplete = await t2.poll();
  assert.equal(incomplete.state === "failed" && incomplete.code, "AI_INVALID_RESPONSE");

  const t3 = setup();
  await t3.start();
  t3.background.finish("resp_1", "isto não é JSON");
  const invalid = await t3.poll();
  assert.equal(invalid.state === "failed" && invalid.code, "AI_INVALID_RESPONSE");
  assert.equal(t3.persisted.length, 0, "nada é gravado sem análise válida");
});

test("timeout confirmado: após o teto, cancela no provedor e marca falha", async () => {
  const t = setup();
  await t.start();
  t.background.responses.set("resp_1", { status: "in_progress" });
  t.clock.advance(JOB_MAX_PROCESSING_MS + 1);
  const view = await t.poll();
  assert.equal(view.state === "failed" && view.code, "AI_TIMEOUT");
  assert.deepEqual(t.background.cancelled, ["resp_1"]);
});

test("falha ao CONSULTAR o provedor não é tratada como falha da análise", async () => {
  const t = setup();
  await t.start();
  t.background.getError = Object.assign(new Error("rede"), { transient: true });
  const view = await t.poll();
  assert.equal(view.state, "processing");
  assert.equal((view as { providerCheckFailed?: boolean }).providerCheckFailed, true);
});

test("início que travou antes de chegar ao provedor libera nova tentativa", async () => {
  const t = setup();
  await t.store.insert({ case_id: CASE_ID, user_id: OWNER, request_id: "req-velho" });
  t.clock.advance(JOB_START_STALE_MS + 1);
  const view = await t.start();
  assert.equal(view.state, "processing");
  assert.equal(t.store.jobs[0].status, "failed");
  assert.equal(t.store.jobs[1].provider_response_id, "resp_1");
});

test("falha temporária ao iniciar: uma nova tentativa limitada", async () => {
  const t = setup();
  t.background.startError = Object.assign(new Error("503"), { transient: true, status: 503 });
  t.background.startErrorsLeft = 1;
  const view = await t.start();
  assert.equal(view.state, "processing");
  assert.equal(t.background.started.length, 1);
});

class SyncFallback implements AIProvider {
  readonly name = "gemini" as const;
  calls: AIProviderCallOptions[] = [];
  async generateText(): Promise<AIProviderResult<string>> {
    throw new Error("não usado");
  }
  async generateStructuredOutput<T>(_messages: AIMessage[], options: AIProviderCallOptions = {}): Promise<AIProviderResult<T>> {
    this.calls.push(options);
    return { provider: "gemini", model: "gemini-test", content: JSON.parse(MODEL_JSON) as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, responseTimeMs: 5 };
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

test("falha permanente ao iniciar: sem retry; usa o provedor alternativo dentro do prazo", async () => {
  const t = setup({ images: 1 });
  t.background.startError = Object.assign(new Error("400"), { transient: false, status: 400 });
  t.background.startErrorsLeft = -1;
  const gemini = new SyncFallback();
  const view = await t.start({ syncFallback: { provider: gemini, model: "gemini-test" } });
  assert.equal(view.state, "completed");
  assert.equal(t.persisted.length, 1);
  assert.ok((gemini.calls[0].timeoutMs ?? 0) <= 54_000);

  const t2 = setup();
  t2.background.startError = Object.assign(new Error("400"), { transient: false, status: 400 });
  t2.background.startErrorsLeft = -1;
  await assert.rejects(t2.start({ syncFallback: null }), (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_UNAVAILABLE");
  assert.equal(t2.store.jobs[0].status, "failed");
});

test("outro usuário não vê status nem resultado", async () => {
  const t = setup();
  await t.start();
  t.background.finish("resp_1", MODEL_JSON);
  const view = await t.poll(OTHER);
  assert.equal(view.state, "idle");
  assert.equal(t.persisted.length, 0, "a consulta de terceiros não grava nada");
});

test("falha no download de uma foto não impede a análise e é informada", async () => {
  const t = setup();
  const data = caseData([
    { image_url: `${PREFIX}${OWNER}/${CASE_ID}/ok.jpg` },
    { image_url: `${PREFIX}${OWNER}/${CASE_ID}/quebrada.jpg` },
  ]);
  const fetchImpl = (async (url: string) =>
    String(url).endsWith("ok.jpg")
      ? { ok: true, headers: new Headers({ "content-type": "image/jpeg" }), arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength) }
      : (() => {
          throw new Error("ECONNRESET");
        })()) as unknown as typeof fetch;
  const view = await t.start({
    prepare: () =>
      prepareAgronomicAnalysis(data, {
        deadlineAt: Date.now() + 54_000,
        prepareImages: () => loadAnalysisImages({ images: data.images, userId: OWNER, caseId: CASE_ID, allowedPrefix: PREFIX, fetchImpl }),
        deps: noResearch,
      }),
  });
  assert.equal(view.state, "processing");
  assert.equal(userMessage(t.background.started[0].messages).images?.length, 1);
  const summary = t.store.jobs[0].image_summary as { analyzed: number; unavailable: Array<{ reason: string }> };
  assert.equal(summary.analyzed, 1);
  assert.equal(summary.unavailable[0].reason, "falha ao carregar o arquivo");
});

test("store Supabase: tabela ausente vira fallback controlado; conflito do índice único é detectado", async () => {
  const missing = createSupabaseAnalysisJobStore({
    supabaseUrl: "https://x.supabase.co",
    serviceRoleKey: "k",
    fetchImpl: (async () => new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.agronomic_analysis_jobs'" }), { status: 404 })) as typeof fetch,
  });
  await assert.rejects(missing.latestForCase(CASE_ID), AnalysisJobStoreUnavailableError);

  const urls: string[] = [];
  const conflict = createSupabaseAnalysisJobStore({
    supabaseUrl: "https://x.supabase.co",
    serviceRoleKey: "k",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method} ${url}`);
      return new Response(JSON.stringify({ code: "23505", message: "duplicate key" }), { status: 409 });
    }) as typeof fetch,
  });
  assert.equal(await conflict.insert({ case_id: CASE_ID, user_id: OWNER, request_id: "r" }), "conflict");
  assert.equal(await conflict.transition("job-1", ["processing"], { status: "saving" }), null);
  assert.ok(urls[1].includes("status=in.(processing)"), "a troca de status é condicional no banco");
});

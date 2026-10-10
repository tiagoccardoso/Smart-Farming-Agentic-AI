/**
 * Análise inicial de casos com fotos (/api/agronomic-ai/analyze-case).
 *
 * Causa raiz: a rota tem 60 s na Vercel, mas pesquisa externa (até 30 s) +
 * provedor principal (até 60 s com retry) + fallback não cabiam nesse tempo; a
 * função era encerrada ("Task timed out after 60 seconds"), a resposta vinha
 * sem JSON e a tela mostrava "Não foi possível gerar a análise". As fotos
 * também nunca chegavam ao modelo (só as URLs iam no texto do prompt).
 *
 * Estes testes garantem: orçamento de tempo respeitado, fotos enviadas como
 * imagem (base64) para OpenAI e Gemini, fotos inválidas declaradas (nunca
 * descartadas em silêncio), acesso restrito à pasta do caso e erro tipado —
 * sem análise falsa — quando a IA não responde.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_MAX_IMAGES,
  ANALYSIS_SAVE_RESERVE_MS,
  AgronomicAnalysisError,
  describeAnalysisImages,
  loadAnalysisImages,
  providerTimeoutMs,
  researchBudgetMs,
  summarizeAnalysisImages,
  type AnalysisImagesResult,
} from "../lib/agronomic/case-analysis";
import { analyzeAgronomicCase, type AgronomicAnalysisRunInfo } from "../src/lib/ai/orchestrator/analyze-case";
import { toGeminiRequest } from "../src/lib/ai/providers/gemini";
import { toResponsesInput } from "../src/lib/ai/providers/openai";
import type { AIMessage, AIProvider, AIProviderCallOptions, AIProviderResult, InternetResearchResult } from "../src/lib/ai/providers/types";

const SUPABASE = "https://projeto.supabase.co";
const PREFIX = `${SUPABASE}/storage/v1/object/public/agronomic-cases/`;
const OWNER = "user-owner";
const CASE_ID = "case-tomate";
const photoUrl = (name: string, owner = OWNER, caseId = CASE_ID) => `${PREFIX}${owner}/${caseId}/${name}`;

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function fakeStorage(files: Record<string, { type: string; body: Buffer } | null>, calls: string[] = []) {
  return (async (url: string) => {
    calls.push(String(url));
    const file = files[String(url)];
    if (!file) return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": file.type }),
      arrayBuffer: async () => file.body.buffer.slice(file.body.byteOffset, file.body.byteOffset + file.body.byteLength),
    };
  }) as unknown as typeof fetch;
}

const VALID_ANALYSIS = {
  initialDiagnosis: "Manchas compatíveis com pinta-preta nas folhas mais velhas.",
  probableHypotheses: ["Pinta-preta (Alternaria solani)"],
  visualFindings: ["Lesões escuras com anéis concêntricos na foto 1."],
  possibleCauses: ["Alta umidade"],
  missingQuestions: ["Qual a porcentagem do talhão afetada?"],
  riskLevel: "medium",
  confidenceLevel: "medium",
  productionImpact: "Redução de área foliar.",
  attentionPoints: ["Monitorar avanço"],
  initialRecommendation: "Confirmar com inspeção de campo.",
  safeInitialRecommendations: ["Remover folhas muito afetadas"],
  whenToCallHumanSpecialist: "Se avançar rápido.",
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

function makeCase(images: Array<{ image_url: string; image_type?: string | null; created_at?: string | null }> = []) {
  return {
    id: CASE_ID,
    user_id: OWNER,
    crop: "Tomate",
    symptoms: "Manchas escuras nas folhas velhas",
    history: null,
    growth_stage: "frutificação",
    soil_analysis_url: null,
    farm: { city: "Campinas", state: "SP" },
    images,
  };
}

function loadedImages(count: number): AnalysisImagesResult {
  return {
    total: count,
    skipped: 0,
    unavailable: [],
    loaded: Array.from({ length: count }, (_, index) => ({
      url: photoUrl(`foto-${index}.jpg`),
      label: `foto ${index + 1} do caso`,
      input: { base64: JPEG_BYTES.toString("base64"), mimeType: "image/jpeg", description: `foto ${index + 1} do caso` },
    })),
  };
}

const userMessage = (call: Call) => call.messages.find((message) => message.role === "user")!;

// ---------------------------------------------------------------- fotos

test("carrega as fotos do caso como base64 e declara as que a IA não consegue ler", async () => {
  const calls: string[] = [];
  const result = await loadAnalysisImages({
    images: [
      { image_url: photoUrl("a.jpg"), image_type: "image/jpeg", created_at: "2026-10-10T10:00:00Z" },
      { image_url: photoUrl("b.heic"), image_type: "image/heic", created_at: "2026-10-10T10:01:00Z" },
      { image_url: photoUrl("vazia.png"), image_type: "image/png", created_at: "2026-10-10T10:02:00Z" },
    ],
    userId: OWNER,
    caseId: CASE_ID,
    allowedPrefix: PREFIX,
    fetchImpl: fakeStorage(
      {
        [photoUrl("a.jpg")]: { type: "image/jpeg", body: JPEG_BYTES },
        [photoUrl("b.heic")]: { type: "image/heic", body: JPEG_BYTES },
        [photoUrl("vazia.png")]: { type: "image/png", body: Buffer.alloc(0) },
      },
      calls,
    ),
  });

  assert.equal(result.total, 3);
  assert.equal(result.loaded.length, 1);
  assert.equal(result.loaded[0].input.mimeType, "image/jpeg");
  assert.equal(result.loaded[0].input.base64, JPEG_BYTES.toString("base64"));
  assert.deepEqual(result.unavailable.map((item) => item.reason).sort(), ["arquivo vazio", "formato HEIC/HEIF não suportado pela IA"]);

  const summary = summarizeAnalysisImages(result);
  assert.equal(summary.analyzed, 1);
  assert.equal(summary.unavailable.length, 2);
  assert.ok(!JSON.stringify(summary).includes("http"), "o resumo público não pode conter URLs");
});

test("não busca arquivos de outro usuário, de outro caso ou de outra origem", async () => {
  const calls: string[] = [];
  const result = await loadAnalysisImages({
    images: [
      { image_url: photoUrl("x.jpg", "outro-usuario") },
      { image_url: photoUrl("y.jpg", OWNER, "outro-caso") },
      { image_url: "https://evil.example.com/z.jpg" },
    ],
    userId: OWNER,
    caseId: CASE_ID,
    allowedPrefix: PREFIX,
    fetchImpl: fakeStorage({}, calls),
  });
  assert.equal(result.loaded.length, 0);
  assert.deepEqual(result.unavailable.map((item) => item.reason), ["origem não permitida", "origem não permitida", "origem não permitida"]);
  assert.equal(calls.length, 0, "nenhuma requisição deve sair para URLs não autorizadas");
});

test("respeita o limite de fotos por análise e informa as que ficaram de fora", async () => {
  const files: Record<string, { type: string; body: Buffer }> = {};
  const images = Array.from({ length: ANALYSIS_MAX_IMAGES + 2 }, (_, index) => {
    const url = photoUrl(`f${index}.jpg`);
    files[url] = { type: "image/jpeg", body: JPEG_BYTES };
    return { image_url: url, image_type: "image/jpeg", created_at: `2026-10-10T10:0${index}:00Z` };
  });
  const result = await loadAnalysisImages({ images, userId: OWNER, caseId: CASE_ID, allowedPrefix: PREFIX, fetchImpl: fakeStorage(files) });
  assert.equal(result.loaded.length, ANALYSIS_MAX_IMAGES);
  assert.equal(result.skipped, 2);
  const notes = describeAnalysisImages(result);
  assert.match(notes, /Outras 2 foto\(s\)/);
  assert.ok(!notes.includes("http"), "o prompt não deve carregar URLs das fotos");
});

// ---------------------------------------------------------------- payload multimodal

test("a análise envia as fotos ao modelo como imagem, não só como texto", async () => {
  const primary = new FakeProvider("openai", () => VALID_ANALYSIS);
  const runInfo: AgronomicAnalysisRunInfo = { images: null };
  const analysis = await analyzeAgronomicCase(
    makeCase([{ image_url: photoUrl("a.jpg"), image_type: "image/jpeg" }, { image_url: photoUrl("b.jpg"), image_type: "image/jpeg" }]),
    {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + 54_000,
      prepareImages: async () => loadedImages(2),
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }) },
    },
    runInfo,
  );

  assert.equal(primary.calls.length, 1);
  const message = userMessage(primary.calls[0]);
  assert.equal(message.images?.length, 2, "as duas fotos precisam ir na mensagem do usuário");
  assert.equal(message.images?.[0].mimeType, "image/jpeg");
  assert.match(message.content, /anexada a esta mensagem/);
  assert.ok(!message.content.includes(PREFIX), "o texto não deve depender da URL da foto");
  assert.equal(runInfo.images?.loaded.length, 2);
  assert.match(analysis.initialDiagnosis, /pinta-preta/i);

  // Formato aceito pelos provedores: input_image (OpenAI) e inlineData (Gemini).
  const openAiInput = toResponsesInput(primary.calls[0].messages) as Array<{ role: string; content: Array<{ type: string; image_url?: string }> }>;
  const openAiUser = openAiInput.find((item) => item.role === "user")!;
  assert.equal(openAiUser.content.filter((part) => part.type === "input_image").length, 2);
  assert.ok(openAiUser.content.every((part) => part.type !== "input_image" || part.image_url?.startsWith("data:image/jpeg;base64,")));
  const gemini = toGeminiRequest(primary.calls[0].messages) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
  assert.equal(gemini.contents[0].parts.filter((part) => "inlineData" in part).length, 2);
});

test("caso só com texto continua funcionando, sem partes de imagem", async () => {
  const primary = new FakeProvider("openai", () => VALID_ANALYSIS);
  await analyzeAgronomicCase(makeCase([]), {
    logUsage: false,
    allowLocalFallback: false,
    deadlineAt: Date.now() + 54_000,
    prepareImages: async () => ({ total: 0, loaded: [], unavailable: [], skipped: 0 }),
    deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }) },
  });
  const message = userMessage(primary.calls[0]);
  assert.equal(message.images, undefined);
  assert.match(message.content, /Nenhuma imagem anexada/);
});

test("o fallback também recebe as fotos", async () => {
  const primary = new FakeProvider("openai", () => {
    throw new Error("Falha na chamada da OpenAI.");
  });
  const fallback = new FakeProvider("gemini", () => VALID_ANALYSIS);
  await analyzeAgronomicCase(makeCase([{ image_url: photoUrl("a.jpg") }]), {
    logUsage: false,
    allowLocalFallback: false,
    deadlineAt: Date.now() + 54_000,
    prepareImages: async () => loadedImages(1),
    deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: fallback, model: "gemini-3.1-pro-preview" } }) },
  });
  assert.equal(fallback.calls.length, 1);
  assert.equal(userMessage(fallback.calls[0]).images?.length, 1);
});

// ---------------------------------------------------------------- orçamento de tempo

test("o orçamento de tempo reserva janela para o fallback e para gravar a análise", () => {
  const now = 1_000_000;
  const deadlineAt = now + 54_000;
  assert.equal(researchBudgetMs(deadlineAt, now), 12_000);
  const primaryTimeout = providerTimeoutMs({ deadlineAt, hasFallback: true, defaultMs: 60_000, now: now + 12_000 });
  assert.equal(primaryTimeout, 54_000 - 12_000 - ANALYSIS_SAVE_RESERVE_MS - 12_000);
  const fallbackTimeout = providerTimeoutMs({ deadlineAt, hasFallback: false, defaultMs: 60_000, now: now + 12_000 + primaryTimeout });
  assert.ok(now + 12_000 + primaryTimeout + fallbackTimeout + ANALYSIS_SAVE_RESERVE_MS <= deadlineAt, "a soma das etapas não pode passar do limite");
  // Sem deadline (outras rotas): mantém o comportamento anterior.
  assert.equal(providerTimeoutMs({ hasFallback: true, defaultMs: 60_000 }), 60_000);
});

test("pesquisa externa lenta não consome o tempo da IA", async () => {
  const primary = new FakeProvider("openai", () => VALID_ANALYSIS);
  const startedAt = Date.now();
  const deadlineAt = startedAt + 30_500; // pesquisa recebe ~1,5 s
  await analyzeAgronomicCase(makeCase([]), {
    logUsage: false,
    allowLocalFallback: false,
    deadlineAt,
    deps: {
      searchKnowledge: () => new Promise(() => undefined),
      searchInternet: () => new Promise(() => undefined),
      selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }),
    },
  });
  assert.equal(primary.calls.length, 1);
  assert.ok(primary.calls[0].at - startedAt < 3_000, "a IA precisa ser chamada logo após o teto da pesquisa");
  assert.ok((primary.calls[0].options.timeoutMs ?? 0) <= deadlineAt - primary.calls[0].at - ANALYSIS_SAVE_RESERVE_MS);
});

test("cada chamada recebe um timeout que termina antes do limite da função", async () => {
  const deadlineAt = Date.now() + 54_000;
  const timeout = (call: Call) => {
    assert.ok(call.at + (call.options.timeoutMs ?? Infinity) + ANALYSIS_SAVE_RESERVE_MS <= deadlineAt + 5);
    throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  };
  const primary = new FakeProvider("openai", timeout);
  const fallback = new FakeProvider("gemini", timeout);
  await assert.rejects(
    analyzeAgronomicCase(makeCase([{ image_url: photoUrl("a.jpg") }]), {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt,
      prepareImages: async () => loadedImages(1),
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: { provider: fallback, model: "gemini" } }) },
    }),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_TIMEOUT" && error.status === 504,
  );
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 1);
});

test("sem tempo útil, não chama a IA e não devolve análise falsa", async () => {
  const primary = new FakeProvider("openai", () => VALID_ANALYSIS);
  await assert.rejects(
    analyzeAgronomicCase(makeCase([]), {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + 8_000,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: primary, model: "gpt-5-mini" }, fallback: null }) },
    }),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_TIMEOUT",
  );
  assert.equal(primary.calls.length, 0);
});

test("provedor indisponível vira erro tipado (sem triagem local) quando a rota pede", async () => {
  const down = new FakeProvider("openai", () => {
    throw new Error("Falha na chamada da OpenAI.");
  });
  await assert.rejects(
    analyzeAgronomicCase(makeCase([]), {
      logUsage: false,
      allowLocalFallback: false,
      deadlineAt: Date.now() + 54_000,
      deps: { ...noResearch, selectProviders: () => ({ primary: { provider: down, model: "gpt-5-mini" }, fallback: null }) },
    }),
    (error: unknown) => error instanceof AgronomicAnalysisError && error.code === "AI_UNAVAILABLE" && error.status === 503,
  );
});

test("outras rotas mantêm a triagem local quando a IA falha (comportamento anterior)", async () => {
  const down = new FakeProvider("openai", () => {
    throw new Error("Falha na chamada da OpenAI.");
  });
  const analysis = await analyzeAgronomicCase(makeCase([]), {
    logUsage: false,
    deps: { ...noResearch, selectProviders: () => ({ primary: { provider: down, model: "gpt-5-mini" }, fallback: null }) },
  });
  assert.ok(analysis.initialDiagnosis.length > 0);
  assert.equal(analysis.sourceMetadata.modelFallbackUsed, true);
});

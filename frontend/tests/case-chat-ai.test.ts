/**
 * Chat de IA por caso (Consultas de Casos).
 *
 * Causa raiz corrigida: o chat reexecutava a análise inicial completa e, com o
 * Gemini indisponível, caía numa "triagem local" com texto FIXO — toda pergunta
 * recebia a mesma resposta. Estes testes garantem que cada pergunta gera uma
 * nova inferência com a pergunta atual, o histórico em papéis corretos e o
 * contexto atualizado do caso, sem resposta falsa em caso de falha.
 *
 * Cenários A–H do pedido + regras de contexto, provedores e persistência.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildChatTimeline } from "../lib/agronomic/case-chat";
import { CaseChatAIError, loadChatImages, type ChatProviders } from "../lib/agronomic/case-chat-ai";
import { buildCaseChatPrompt, isLikelyQuestion, pendingAnswerFromTurn } from "../lib/agronomic/case-chat-context";
import { parseChatMarkdown } from "../lib/agronomic/chat-markdown";
import { CaseChatAccessError, recordUserTurn, runAssistantTurn } from "../lib/server/case-chat-service";
import { createSupabaseCaseChatStore, resetCaseChatStoreColumnCache } from "../lib/server/case-chat-store";
import { toGeminiRequest, GeminiProvider } from "../src/lib/ai/providers/gemini";
import { toResponsesInput } from "../src/lib/ai/providers/openai";
import { MemoryChatDb, ScriptedProvider, lastUserContent, makeCase, systemContent, type ProviderCall } from "./helpers/case-chat-fakes";

const OWNER = "user-owner";
const OTHER = "user-intruso";
const CASE_A = "case-tomate";
const CASE_B = "case-soja";
const silent = () => undefined;

/** "Agrônomo" falso: responde de acordo com a pergunta atual e o histórico. */
function agronomistBehavior(call: ProviderCall) {
  const current = lastUserContent(call).toLowerCase();
  if (current.includes("segunda hipótese")) {
    const previousAnswers = call.messages.filter((message) => message.role === "assistant").map((message) => message.content);
    const lastList = [...previousAnswers].reverse().find((text) => /\n?2\.\s/.test(text)) ?? "";
    const second = lastList.match(/2\.\s+\*\*(.+?)\*\*/)?.[1] ?? "não encontrei a segunda hipótese no histórico";
    return `Sobre a segunda hipótese, **${second}**: forma manchas pequenas com centro claro e se espalha com respingos de água.`;
  }
  if (current.includes("causas possíveis") || current.includes("possível causa")) {
    return "As causas mais prováveis para essas manchas são:\n1. **Pinta-preta (Alternaria solani)**: anéis concêntricos em folhas velhas.\n2. **Septoriose (Septoria lycopersici)**: manchas pequenas de centro claro.\n3. **Deficiência de potássio**: menos provável.";
  }
  if (current.includes("irrigação")) {
    return "Sim. A irrigação por aspersão no fim da tarde mantém as folhas molhadas à noite e favorece fungos. Prefira irrigar de manhã ou por gotejamento.";
  }
  if (current.includes("informações faltam")) {
    return "Para confirmar seria preciso: fotos de perto do verso das folhas, a porcentagem de plantas afetadas e, se possível, análise em laboratório de fitopatologia.";
  }
  return `Resposta específica para: ${current.slice(0, 80)}`;
}

function setup(options: { behavior?: (call: ProviderCall) => Promise<string> | string; fallback?: ScriptedProvider | null } = {}) {
  const db = new MemoryChatDb();
  db.cases.set(CASE_A, makeCase({ id: CASE_A, user_id: OWNER }));
  db.cases.set(
    CASE_B,
    makeCase({
      id: CASE_B,
      user_id: OWNER,
      crop: "Soja",
      symptoms: "Pústulas ferruginosas na face inferior das folhas.",
      history: "Plantio direto, sem irrigação.",
      crop_context: { display_name_pt: "Soja", scientific_name: "Glycine max" },
      ai_analysis_json: { initialDiagnosis: "Suspeita de ferrugem-asiática.", detailedHypotheses: [{ name: "Ferrugem-asiática", probability: "high", justification: "Pústulas." }], riskLevel: "high" },
    }),
  );
  const primary = new ScriptedProvider("openai", options.behavior ?? agronomistBehavior);
  const fallback = options.fallback === undefined ? new ScriptedProvider("gemini", agronomistBehavior) : options.fallback;
  const providers: ChatProviders = { primary: { provider: primary, model: "gpt-teste" }, fallback: fallback ? { provider: fallback, model: "gemini-teste" } : null };
  return { db, primary, fallback, providers };
}

async function ask(db: MemoryChatDb, providers: ChatProviders, caseId: string, text: string, extra: { clientMessageId?: string; imageUrls?: string[]; userId?: string } = {}) {
  const store = db.storeFor(extra.userId ?? OWNER);
  await recordUserTurn(store, { caseId, userId: extra.userId ?? OWNER, text, clientMessageId: extra.clientMessageId ?? null, imageUrls: extra.imageUrls ?? [], imageLabel: "Foto enviada pelo produtor durante a conversa.", audioLabel: "Mensagem de áudio enviada pelo produtor." });
  return runAssistantTurn(store, { caseId, userId: extra.userId ?? OWNER, requestId: "req-teste", providers, logger: silent });
}

function assistantTexts(db: MemoryChatDb, caseId: string) {
  return db.messages.filter((message) => message.case_id === caseId && message.role === "assistant").map((message) => message.message);
}

// ---------------------------------------------------------------------------
// Teste A — perguntas diferentes
// ---------------------------------------------------------------------------

test("A: cada pergunta gera nova inferência e uma resposta específica", async () => {
  const { db, primary, providers } = setup();
  const analysisBefore = JSON.stringify(db.cases.get(CASE_A)!.ai_analysis_json);
  const questions = ["Qual é a possível causa dessas manchas?", "A irrigação pode influenciar?", "Que informações faltam para confirmar o diagnóstico?"];

  for (const question of questions) {
    const result = await ask(db, providers, CASE_A, question);
    assert.equal(result.status, "answered");
  }

  assert.equal(primary.calls.length, 3, "uma inferência por pergunta");
  primary.calls.forEach((call, index) => {
    assert.match(lastUserContent(call), new RegExp(questions[index].replace(/[?]/g, "\\?")), "a pergunta atual é a última mensagem enviada ao modelo");
  });
  const answers = assistantTexts(db, CASE_A);
  assert.equal(new Set(answers).size, 3, "respostas diferentes");
  assert.match(answers[0], /Pinta-preta/);
  assert.match(answers[1], /aspersão|irrig/i);
  assert.match(answers[2], /laboratório|fotos/i);
  // A análise inicial não é regravada pelo chat.
  assert.equal(JSON.stringify(db.cases.get(CASE_A)!.ai_analysis_json), analysisBefore);
  // Cada resposta aponta para a pergunta que respondeu.
  const rows = db.messages.filter((message) => message.case_id === CASE_A);
  rows.forEach((row, index) => {
    if (row.role === "assistant") assert.equal(row.reply_to_message_id, rows[index - 1].id);
  });
});

test("A: a análise inicial entra só como referência, separada da pergunta", async () => {
  const { db, primary, providers } = setup();
  await ask(db, providers, CASE_A, "A irrigação pode influenciar?");
  const system = systemContent(primary.calls[0]);
  assert.match(system, /Análise inicial da IA.*REFERÊNCIA/);
  assert.match(system, /1\. Pinta-preta/);
  assert.doesNotMatch(lastUserContent(primary.calls[0]), /Pinta-preta/, "a mensagem do usuário não é misturada com a análise");
});

// ---------------------------------------------------------------------------
// Teste B — continuidade
// ---------------------------------------------------------------------------

test("B: a IA recebe o histórico em papéis corretos e entende 'a segunda hipótese'", async () => {
  const { db, primary, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");
  await ask(db, providers, CASE_A, "Explique melhor a segunda hipótese.");

  const second = primary.calls[1];
  assert.deepEqual(second.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.match(second.messages[1].content, /causas possíveis/);
  assert.match(second.messages[2].content, /2\. \*\*Septoriose/);
  assert.match(assistantTexts(db, CASE_A)[1], /Septoriose/);
});

// ---------------------------------------------------------------------------
// Teste C — persistência
// ---------------------------------------------------------------------------

test("C: histórico completo é recuperado ao 'recarregar' o caso", async () => {
  const { db, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");
  await ask(db, providers, CASE_A, "A irrigação pode influenciar?");

  const reloaded = await db.storeFor(OWNER).listMessages(CASE_A);
  assert.deepEqual(reloaded.map((row) => row.role), ["user", "assistant", "user", "assistant"]);
  const timeline = buildChatTimeline(reloaded);
  assert.equal(timeline.length, 4);
  assert.equal(timeline[2].kind === "text" && timeline[2].text, "A irrigação pode influenciar?");
});

// ---------------------------------------------------------------------------
// Teste D — isolamento entre casos
// ---------------------------------------------------------------------------

test("D: contexto e histórico de um caso não vazam para outro", async () => {
  const { db, primary, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");
  await ask(db, providers, CASE_B, "O que devo observar nos próximos dias?");

  const callB = primary.calls[1];
  const everything = callB.messages.map((message) => message.content).join("\n");
  assert.match(everything, /Soja/);
  assert.doesNotMatch(everything, /Tomate|Pinta-preta|causas possíveis/);
  assert.deepEqual(callB.messages.map((message) => message.role), ["system", "user"]);
  assert.equal(assistantTexts(db, CASE_B).length, 1);
  const caseBRows = await db.storeFor(OWNER).listMessages(CASE_B);
  assert.ok(caseBRows.every((row) => row.case_id === CASE_B));
});

// ---------------------------------------------------------------------------
// Teste E — contexto atualizado após edição e nova foto
// ---------------------------------------------------------------------------

test("E: edição do caso e nova foto entram na próxima pergunta (foto enviada de verdade)", async () => {
  const { db, primary, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");

  const current = db.cases.get(CASE_A)!;
  current.symptoms = "Agora as manchas chegaram aos frutos, com podridão escura no pedúnculo.";
  current.images = [{ id: "img-1", image_url: "https://projeto.supabase.co/storage/v1/object/public/agronomic-cases/u/c/foto.jpg", image_type: "photo", created_at: "2026-10-08T09:00:00.000Z" }];
  db.updates.set(CASE_A, [{ at: "2026-10-08T09:00:00.000Z", description: "produtor editou o caso (sintomas)" }]);

  const store = db.storeFor(OWNER);
  await recordUserTurn(store, { caseId: CASE_A, userId: OWNER, text: "Isso muda alguma coisa?", clientMessageId: null, imageUrls: [], imageLabel: "x", audioLabel: "y" });
  await runAssistantTurn(store, {
    caseId: CASE_A,
    userId: OWNER,
    requestId: "req",
    providers,
    logger: silent,
    loadImages: async (candidates) => ({ loaded: candidates.map((candidate) => ({ ...candidate, input: { base64: "QUJD", mimeType: "image/jpeg" } })), unavailable: [] }),
  });

  const call = primary.calls[1];
  assert.match(systemContent(call), /chegaram aos frutos/);
  assert.match(systemContent(call), /produtor editou o caso \(sintomas\)/);
  const last = call.messages[call.messages.length - 1];
  assert.equal(last.images?.length, 1, "a imagem vai como conteúdo, não só como nome/URL");
  assert.equal(last.images?.[0].base64, "QUJD");
  assert.match(last.content, /imagem 1 = foto do caso/);
});

test("E: foto que não pôde ser carregada é declarada indisponível ao modelo", async () => {
  const result = await loadChatImages(
    [
      { url: "https://evil.example.com/x.jpg", label: "foto externa", source: "chat" },
      { url: "https://projeto.supabase.co/storage/v1/object/public/agronomic-cases/a.heic", label: "foto heic", source: "chat" },
    ],
    {
      allowedPrefix: "https://projeto.supabase.co/storage/v1/object/public/agronomic-cases/",
      fetchImpl: (async () => ({ ok: true, headers: new Headers({ "content-type": "image/heic" }), arrayBuffer: async () => new ArrayBuffer(4) })) as unknown as typeof fetch,
    },
  );
  assert.equal(result.loaded.length, 0);
  assert.deepEqual(result.unavailable.map((item) => item.reason), ["origem não permitida", "formato HEIC não suportado pela IA"]);
});

// ---------------------------------------------------------------------------
// Teste F — falha do provedor
// ---------------------------------------------------------------------------

test("F: timeout e indisponibilidade não geram resposta falsa; a pergunta fica salva", async () => {
  const timeout = () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  };
  const fallback = new ScriptedProvider("gemini", () => {
    throw new Error("This model models/gemini-2.5-pro is no longer available to new users.");
  });
  const { db, providers } = setup({ behavior: timeout, fallback });
  const analysisBefore = JSON.stringify(db.cases.get(CASE_A)!.ai_analysis_json);

  await assert.rejects(() => ask(db, providers, CASE_A, "A irrigação pode influenciar?"), (error: unknown) => {
    assert.ok(error instanceof CaseChatAIError);
    assert.equal(error.attempts.length, 2);
    assert.equal(error.attempts[0].category, "timeout");
    return true;
  });
  assert.equal(fallback.calls.length, 1, "fallback tentado com a mesma pergunta");
  const rows = db.messages.filter((message) => message.case_id === CASE_A);
  assert.deepEqual(rows.map((row) => row.role), ["user"], "pergunta preservada, nenhuma resposta inventada");
  assert.equal(JSON.stringify(db.cases.get(CASE_A)!.ai_analysis_json), analysisBefore, "análise antiga não é devolvida nem regravada");
});

test("F: fallback recebe exatamente as mesmas mensagens e responde", async () => {
  const { db, primary, fallback, providers } = setup({
    behavior: () => {
      throw new Error("500 upstream");
    },
  });
  const result = await ask(db, providers, CASE_A, "A irrigação pode influenciar?");
  assert.equal(result.status, "answered");
  assert.equal(result.status === "answered" && result.fallbackUsed, true);
  assert.deepEqual(fallback!.calls[0].messages, primary.calls[0].messages);
});

test("F: sem provedor configurado, erro explícito (sem texto fixo)", async () => {
  const { db } = setup();
  await assert.rejects(() => ask(db, { primary: null, fallback: null }, CASE_A, "Oi?"), (error: unknown) => error instanceof CaseChatAIError && error.category === "not_configured");
  assert.equal(assistantTexts(db, CASE_A).length, 0);
});

test("F: resposta vazia do modelo é falha, não resposta", async () => {
  const { db, providers } = setup({ behavior: () => "   ", fallback: null });
  await assert.rejects(() => ask(db, providers, CASE_A, "Oi?"), (error: unknown) => error instanceof CaseChatAIError && error.category === "empty_response");
});

// ---------------------------------------------------------------------------
// Teste G — concorrência e reenvio
// ---------------------------------------------------------------------------

test("G: reenvio com o mesmo clientMessageId não duplica a pergunta", async () => {
  const { db } = setup();
  const store = db.storeFor(OWNER);
  const turn = { caseId: CASE_A, userId: OWNER, text: "A irrigação pode influenciar?", clientMessageId: "msg-abc12345", imageUrls: [], imageLabel: "x", audioLabel: "y" };
  await recordUserTurn(store, turn);
  const second = await recordUserTurn(store, turn);
  assert.equal(second.duplicateText, true);
  assert.equal(db.messages.length, 1);
});

test("G: duas gerações simultâneas para o mesmo turno gravam uma única resposta", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { db, providers } = setup({
    behavior: async (call) => {
      await gate;
      return agronomistBehavior(call);
    },
  });
  const store = db.storeFor(OWNER);
  await recordUserTurn(store, { caseId: CASE_A, userId: OWNER, text: "A irrigação pode influenciar?", clientMessageId: null, imageUrls: [], imageLabel: "x", audioLabel: "y" });
  const first = runAssistantTurn(store, { caseId: CASE_A, userId: OWNER, requestId: "r1", providers, logger: silent });
  const second = runAssistantTurn(store, { caseId: CASE_A, userId: OWNER, requestId: "r2", providers, logger: silent });
  release();
  const results = await Promise.all([first, second]);
  assert.equal(assistantTexts(db, CASE_A).length, 1);
  assert.deepEqual(results.map((result) => result.status).sort(), ["already_answered", "answered"]);
});

test("G: respostas de perguntas consecutivas ficam associadas à pergunta certa", async () => {
  const { db, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");
  await ask(db, providers, CASE_A, "A irrigação pode influenciar?");
  const rows = db.messages.filter((message) => message.case_id === CASE_A);
  assert.equal(rows[1].reply_to_message_id, rows[0].id);
  assert.equal(rows[3].reply_to_message_id, rows[2].id);
  assert.match(rows[3].message, /aspersão/);
});

// ---------------------------------------------------------------------------
// Teste H — segurança
// ---------------------------------------------------------------------------

test("H: outro usuário não gera resposta nem lê o histórico do caso", async () => {
  const { db, primary, providers } = setup();
  await ask(db, providers, CASE_A, "Quais são as causas possíveis?");
  const intruder = db.storeFor(OTHER);
  await assert.rejects(() => runAssistantTurn(intruder, { caseId: CASE_A, userId: OTHER, requestId: "x", providers, logger: silent }), CaseChatAccessError);
  assert.deepEqual(await intruder.listMessages(CASE_A), []);
  await assert.rejects(() => recordUserTurn(intruder, { caseId: CASE_A, userId: OTHER, text: "invadir", clientMessageId: null, imageUrls: [], imageLabel: "x", audioLabel: "y" }));
  assert.equal(primary.calls.length, 1, "nenhuma inferência para o intruso");
});

// ---------------------------------------------------------------------------
// Fila de perguntas pendentes, parecer humano e limites de contexto
// ---------------------------------------------------------------------------

test("pergunta do produtor não é gravada como resposta da fila; afirmação é", async () => {
  const { db, providers } = setup();
  db.pending.push({ id: "q1", case_id: CASE_A, question: "Qual porcentagem do talhão está afetada?", answer: null, status: "pending", order_index: 0 });
  await ask(db, providers, CASE_A, "A irrigação pode influenciar?");
  assert.equal(db.pending[0].status, "pending");
  await ask(db, providers, CASE_A, "Uns 30% das plantas, mais na bordadura.");
  assert.equal(db.pending[0].status, "answered");
  assert.equal(db.pending[0].answer, "Uns 30% das plantas, mais na bordadura.");
  assert.equal(isLikelyQuestion("Explique melhor a segunda hipótese."), true);
  assert.equal(pendingAnswerFromTurn([{ id: "1", role: "user", message: "Começou há 5 dias", message_type: "text", file_url: null, created_at: null }]), "Começou há 5 dias");
});

test("parecer humano entra atribuído ao agrônomo, nunca como conclusão da IA", async () => {
  const { db, primary, providers } = setup();
  db.reviews.set(CASE_A, { reviewText: "Confirmo pinta-preta pelo padrão das lesões.", technicalRecommendation: "Remover folhas baixas.", finalObservations: null, reviewedAt: "2026-10-08T08:00:00.000Z" });
  await ask(db, providers, CASE_A, "O que o agrônomo concluiu?");
  const system = systemContent(primary.calls[0]);
  assert.match(system, /Parecer técnico HUMANO \(emitido por agrônomo do PlantaSa/);
  assert.match(system, /não é da IA/);
});

test("conversas longas: mensagens antigas viram resumo e o contexto fica limitado", () => {
  const rows = [] as Parameters<typeof buildCaseChatPrompt>[0]["rows"];
  for (let index = 0; index < 60; index += 1) {
    rows.push({ id: `u${index}`, role: "user", message: `Pergunta ${index} ${"detalhe ".repeat(60)}`, message_type: "text", file_url: null, created_at: null });
    rows.push({ id: `a${index}`, role: "assistant", message: `Resposta ${index} ${"explicação ".repeat(80)}`, message_type: "text", file_url: null, created_at: null });
  }
  rows.push({ id: "atual", role: "user", message: "Pergunta atual sobre adubação?", message_type: "text", file_url: null, created_at: null });
  const prompt = buildCaseChatPrompt({ caseData: makeCase({ id: CASE_A, user_id: OWNER }), rows });
  assert.ok(prompt.stats.summarizedTurns > 0);
  assert.ok(prompt.stats.totalChars < 30000, `contexto grande demais: ${prompt.stats.totalChars}`);
  assert.equal(prompt.messages[1].role, "user");
  assert.match(prompt.messages[0].content, /RESUMO COMPACTO/);
  assert.match(prompt.messages[prompt.messages.length - 1].content, /Pergunta atual sobre adubação/);
  for (let index = 2; index < prompt.messages.length; index += 1) {
    assert.notEqual(prompt.messages[index].role, prompt.messages[index - 1].role, "papéis alternados");
  }
});

test("mensagens iniciais da IA (antes do produtor) vão para o contexto, não abrem a conversa", () => {
  const prompt = buildCaseChatPrompt({
    caseData: makeCase({ id: CASE_A, user_id: OWNER }),
    rows: [
      { id: "a0", role: "assistant", message: "Pré-análise gerada.", message_type: "text", file_url: null, created_at: null },
      { id: "u1", role: "user", message: "Oi?", message_type: "text", file_url: null, created_at: null },
    ],
  });
  assert.deepEqual(prompt.messages.map((message) => message.role), ["system", "user"]);
  assert.match(prompt.messages[0].content, /Pré-análise gerada/);
});

// ---------------------------------------------------------------------------
// Provedores e persistência Supabase
// ---------------------------------------------------------------------------

test("OpenAI: mensagens do assistente usam output_text e imagens viram input_image", () => {
  const input = toResponsesInput([
    { role: "system", content: "s" },
    { role: "user", content: "u", images: [{ base64: "QUJD", mimeType: "image/png" }] },
    { role: "assistant", content: "a" },
  ]) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.equal(input[2].content[0].type, "output_text");
  assert.equal(input[1].content[1].type, "input_image");
  assert.equal(input[1].content[1].image_url, "data:image/png;base64,QUJD");
});

test("Gemini: sistema em systemInstruction (não repetido) e imagem em inlineData", () => {
  const request = toGeminiRequest([
    { role: "system", content: "regras" },
    { role: "user", content: "p1" },
    { role: "assistant", content: "r1" },
    { role: "user", content: "p2", images: [{ base64: "QUJD", mimeType: "image/jpeg" }] },
  ]) as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>; systemInstruction?: { parts: Array<{ text: string }> } };
  assert.equal(request.systemInstruction?.parts[0].text, "regras");
  assert.deepEqual(request.contents.map((content) => content.role), ["user", "model", "user"]);
  assert.equal(request.contents[0].parts[0].text, "p1");
  assert.ok(request.contents[2].parts[1].inlineData);
});

test("Gemini: modelo descontinuado é trocado pelo substituto automaticamente", async () => {
  process.env.GEMINI_API_KEY = "chave-teste";
  process.env.GEMINI_FALLBACK_MODEL = "gemini-substituto";
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    if (url.includes("gemini-2.5-pro")) {
      return { ok: false, status: 404, json: async () => ({ error: { message: "This model models/gemini-2.5-pro is no longer available to new users." } }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
  }) as unknown as typeof fetch;
  try {
    const result = await new GeminiProvider().generateText([{ role: "user", content: "oi" }], { model: "gemini-2.5-pro" });
    assert.equal(result.content, "ok");
    assert.equal(result.model, "gemini-substituto");
    assert.equal(urls.length, 2);
  } finally {
    globalThis.fetch = original;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test("store Supabase: funciona antes da migration (sem as colunas novas)", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  resetCaseChatStoreColumnCache();
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if ("client_message_id" in body) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ code: "PGRST204", message: "Could not find the 'client_message_id' column" }) };
      }
      return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "m1", ...body, created_at: "2026-10-08T00:00:00Z" }]) };
    }
    if (String(url).includes("client_message_id,reply_to_message_id")) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ code: "42703", message: "column case_chat_messages.client_message_id does not exist" }) };
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }) as unknown as typeof fetch;
  try {
    const store = createSupabaseCaseChatStore({ token: "t", fetchCase: async () => null });
    const row = await store.insertMessage({ caseId: "c", userId: "u", role: "user", message: "oi", clientMessageId: "msg-12345678" });
    assert.equal(row?.id, "m1");
    assert.equal(bodies.length, 2);
    assert.deepEqual(await store.listMessages("c"), []);
  } finally {
    globalThis.fetch = original;
    resetCaseChatStoreColumnCache();
  }
});

test("Markdown do chat preserva a numeração das listas e o negrito", () => {
  const blocks = parseChatMarkdown("Hipóteses:\n1. **Pinta-preta**: anéis\n2. Septoriose\n\n- item *leve*");
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[1].type === "numbered" && blocks[1].start, 1);
  assert.equal(blocks[1].type === "numbered" && blocks[1].items.length, 2);
  assert.deepEqual(blocks[1].type === "numbered" && blocks[1].items[0][0], { text: "Pinta-preta", bold: true });
  assert.deepEqual(blocks[2].type === "bullets" && blocks[2].items[0][1], { text: "leve", italic: true });
});

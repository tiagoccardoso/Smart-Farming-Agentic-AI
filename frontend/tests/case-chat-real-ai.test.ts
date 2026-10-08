/**
 * Integração REAL com o provedor de IA (opcional; consome créditos).
 *
 *   RUN_REAL_AI_TESTS=1 OPENAI_API_KEY=... [GEMINI_API_KEY=...] npm test
 *
 * Sem essas variáveis, os testes são pulados — a validação com mocks NÃO
 * substitui esta. Verifica pertinência semântica das respostas (palavras-chave
 * do tema de cada pergunta), não igualdade literal.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { recordUserTurn, runAssistantTurn } from "../lib/server/case-chat-service";
import { getCaseChatProviders } from "../lib/agronomic/case-chat-providers";
import { MemoryChatDb, makeCase } from "./helpers/case-chat-fakes";

const enabled = process.env.RUN_REAL_AI_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
const OWNER = "owner";
const CASE = "case-real";

async function ask(db: MemoryChatDb, text: string) {
  const store = db.storeFor(OWNER);
  await recordUserTurn(store, { caseId: CASE, userId: OWNER, text, clientMessageId: null, imageUrls: [], imageLabel: "x", audioLabel: "y" });
  const result = await runAssistantTurn(store, { caseId: CASE, userId: OWNER, requestId: "real", providers: getCaseChatProviders(), deadlineAt: Date.now() + 90_000 });
  assert.equal(result.status, "answered");
  return result.status === "answered" ? result.message.message : "";
}

test("real A: três perguntas diferentes recebem respostas pertinentes", { skip: !enabled, timeout: 240_000 }, async () => {
  const db = new MemoryChatDb();
  db.cases.set(CASE, makeCase({ id: CASE, user_id: OWNER }));
  const a1 = await ask(db, "Qual é a possível causa dessas manchas?");
  const a2 = await ask(db, "A irrigação pode influenciar?");
  const a3 = await ask(db, "Que informações faltam para confirmar o diagnóstico?");
  assert.match(a1, /alternaria|pinta|fung|septori/i);
  assert.match(a2, /irriga|água|umidade|molha|aspers/i);
  assert.match(a3, /foto|laborat|análise|informa|amostra/i);
  assert.notEqual(a1, a2);
  assert.notEqual(a2, a3);
});

test("real B: entende referência à segunda hipótese", { skip: !enabled, timeout: 180_000 }, async () => {
  const db = new MemoryChatDb();
  db.cases.set(CASE, makeCase({ id: CASE, user_id: OWNER }));
  const first = await ask(db, "Quais são as causas possíveis? Liste numeradas.");
  const secondName = first.match(/^\s*2[.)]\s*\**([^:*\n]+)/m)?.[1]?.trim().split(/\s+/)[0] ?? "";
  const second = await ask(db, "Explique melhor a segunda hipótese.");
  assert.ok(secondName.length > 2, `não achei a 2ª hipótese em: ${first}`);
  assert.match(second.toLowerCase(), new RegExp(secondName.toLowerCase().replace(/[^a-zà-ú]/g, "").slice(0, 6)));
});

/**
 * Histórico do caso: detecção de informações novas após a última análise,
 * agrupamento do chat (áudio + transcrição, fotos), contexto enviado à IA e a
 * linha do tempo do Painel da Doutora.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeCaseFreshness, splitActivityLogs } from "../lib/agronomic/case-freshness";
import { AUDIO_MESSAGE_LABEL, IMAGE_MESSAGE_LABEL, buildChatTimeline, buildUserTurnContext, trailingUserMessages, type ChatMessageRow } from "../lib/agronomic/case-chat";
import { buildSpecialistTimeline, decorateTimeline } from "../lib/agronomic/specialist-timeline";

const log = (id: string, created_at: string, metadata: Record<string, unknown> | null, action = "x") => ({ id, action, metadata, created_at });

test("atualização depois da análise ativa 'novas informações'", () => {
  const freshness = computeCaseFreshness({
    hasAnalysis: true,
    analyzedAt: "2026-10-07T10:00:00.000Z",
    activityLogs: [
      log("1", "2026-10-07T09:00:00.000Z", { kind: "case_updated" }),
      log("2", "2026-10-07T11:00:00.000Z", { kind: "attachment_added", attachment: "photo" }),
    ],
  });
  assert.equal(freshness.hasUpdatesSinceAnalysis, true);
  assert.equal(freshness.updatesSinceAnalysis, 1);
});

test("nova análise posterior zera o aviso", () => {
  const freshness = computeCaseFreshness({
    hasAnalysis: true,
    analyzedAt: "2026-10-07T12:00:00.000Z",
    activityLogs: [log("2", "2026-10-07T11:00:00.000Z", { kind: "attachment_added" })],
  });
  assert.equal(freshness.hasUpdatesSinceAnalysis, false);
});

test("análise legada sem data: registro legado não dispara, registro novo dispara", () => {
  const legacyOnly = computeCaseFreshness({ hasAnalysis: true, analyzedAt: null, activityLogs: [log("1", "2026-05-01T00:00:00.000Z", null, "Usuário editou")] });
  assert.equal(legacyOnly.hasUpdatesSinceAnalysis, false);
  const withNew = computeCaseFreshness({ hasAnalysis: true, analyzedAt: null, activityLogs: [log("2", "2026-10-08T00:00:00.000Z", { kind: "case_updated" })] });
  assert.equal(withNew.hasUpdatesSinceAnalysis, true);
});

test("sem análise não há aviso de atualização", () => {
  const freshness = computeCaseFreshness({ hasAnalysis: false, activityLogs: [log("1", "2026-10-08T00:00:00.000Z", { kind: "case_updated" })] });
  assert.equal(freshness.hasUpdatesSinceAnalysis, false);
});

test("histórico de análises separa a versão anterior e enxuga os registros", () => {
  const { activityLogs, analysisHistory } = splitActivityLogs([
    log("a", "2026-10-07T10:00:00.000Z", { kind: "ai_analysis", source: "analysis", previous: { initialDiagnosis: "Antiga", riskLevel: "high", analyzedAt: "2026-10-01T00:00:00.000Z", popularSummary: "Resumo antigo" } }),
  ]);
  assert.equal(analysisHistory.length, 1);
  assert.equal(analysisHistory[0].previous?.riskLevel, "high");
  assert.equal(analysisHistory[0].previous?.summary, "Resumo antigo");
  assert.equal("previous" in (activityLogs[0].metadata ?? {}), false);
});

const row = (id: string, role: "user" | "assistant", message_type: ChatMessageRow["message_type"], message: string, file_url: string | null = null, minute = 0): ChatMessageRow => ({
  id,
  role,
  message,
  message_type,
  file_url,
  created_at: new Date(Date.UTC(2026, 9, 7, 12, minute)).toISOString(),
});

test("áudio agrupa a transcrição seguinte; foto vira miniatura", () => {
  const timeline = buildChatTimeline([
    row("1", "user", "audio", AUDIO_MESSAGE_LABEL, "https://x/a.webm", 1),
    row("2", "user", "transcription", "As folhas estão amarelando", null, 1),
    row("3", "user", "image", IMAGE_MESSAGE_LABEL, "https://x/f.jpg", 2),
    row("4", "assistant", "text", "Entendi.", null, 3),
  ]);
  assert.equal(timeline.length, 3);
  assert.ok(timeline[0].kind === "audio" && timeline[0].transcription === "As folhas estão amarelando");
  assert.ok(timeline[1].kind === "image" && timeline[1].caption === null);
});

test("áudio sem transcrição continua visível e a IA é avisada", () => {
  const rows = [row("1", "assistant", "text", "Oi", null, 0), row("2", "user", "audio", AUDIO_MESSAGE_LABEL, "https://x/a.webm", 1)];
  const timeline = buildChatTimeline(rows);
  assert.ok(timeline[1].kind === "audio" && timeline[1].transcription === null && timeline[1].url);
  const pending = trailingUserMessages(rows);
  assert.equal(pending.length, 1);
  assert.match(buildUserTurnContext(pending), /transcrição automática não foi concluída/);
});

test("mensagens sem resposta: só as do final da conversa", () => {
  const rows = [row("1", "user", "text", "A"), row("2", "assistant", "text", "B"), row("3", "user", "text", "C"), row("4", "user", "image", IMAGE_MESSAGE_LABEL, "https://x/1.jpg")];
  assert.deepEqual(trailingUserMessages(rows).map((item) => item.id), ["3", "4"]);
  assert.equal(trailingUserMessages([...rows, row("5", "assistant", "text", "D")]).length, 0);
});

test("linha do tempo da especialista em ordem e com destaques", () => {
  const entries = buildSpecialistTimeline({
    case: { created_at: "2026-10-01T00:00:00.000Z", symptoms: "x" },
    requestedAt: "2026-10-02T00:00:00.000Z",
    messages: [row("m1", "user", "text", "Piorou", null, 0)],
    activityLogs: [log("l1", "2026-10-03T00:00:00.000Z", { kind: "case_updated", fields: ["symptoms"] }), log("l2", "2026-10-05T00:00:00.000Z", { kind: "attachment_added", attachment: "photo" })],
    analysisHistory: [{ id: "a1", createdAt: "2026-10-01T01:00:00.000Z", source: "analysis" }],
    reviews: [{ id: "r1", status: "in_review", reviewed_at: null, created_at: "2026-10-04T00:00:00.000Z", bySpecialist: true }],
  });
  const kinds = entries.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["created", "analysis", "request", "update", "review", "update", "chat"]);
  const update = entries.find((entry) => entry.kind === "update");
  assert.ok(update && update.kind === "update" && update.detail === "Campos: sintomas");

  const decorated = decorateTimeline(entries, { lastSeenAt: "2026-10-04T12:00:00.000Z", requestedAt: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(decorated.filter((entry) => entry.isNew).map((entry) => entry.id), ["log-l2", "chat-m1"]);
  assert.equal(decorated.find((entry) => entry.id === "log-l1")?.afterRequest, true);
  assert.equal(decorated.find((entry) => entry.kind === "review")?.isNew, false, "ação da própria especialista não é novidade");
});

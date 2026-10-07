/**
 * Visão do produtor na Revisão Humana: etapa atual, parecer exibível (sem
 * rascunhos), linha do tempo, leitura de textos longos e indicador "Novo".
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_REQUESTED_LOG_ACTION,
  type StoredHumanReview,
  buildClientHumanReview,
  buildReviewTimeline,
  getClientReviewStage,
  isOpinionUnseen,
  markOpinionSeen,
  parseSeenOpinions,
  pickClientReviewRow,
  redactUnfinishedReview,
  toTextBlocks,
} from "../lib/agronomic/client-review";

const SPECIALIST = "33333333-3333-3333-3333-333333333333";

function row(overrides: Partial<StoredHumanReview>): StoredHumanReview {
  return {
    id: overrides.id ?? "r1",
    case_id: "case-1",
    specialist_id: null,
    status: "pending",
    review_text: null,
    technical_recommendation: null,
    final_observations: null,
    reviewed_at: null,
    created_at: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

test("etapa: status do caso viram estados compreensíveis para o produtor", () => {
  assert.equal(getClientReviewStage({ human_review_status: "waiting_review", human_review_requested: true }), "waiting_review");
  assert.equal(getClientReviewStage({ human_review_status: "in_review", human_review_requested: true }), "in_review");
  assert.equal(getClientReviewStage({ human_review_status: "reviewed", human_review_requested: true }), "completed");
  assert.equal(getClientReviewStage({ human_review_status: "completed" }), "completed");
  assert.equal(getClientReviewStage({ human_review_status: null, status: "human_reviewed" }), "completed");
  assert.equal(getClientReviewStage({ human_review_status: "pending_payment" }), "pending_payment");
  assert.equal(getClientReviewStage({ human_review_status: "pending" }), "pending_payment");
  assert.equal(getClientReviewStage({ human_review_status: "cancelled" }), "cancelled");
  assert.equal(getClientReviewStage({ human_review_status: "rejected" }), "rejected");
  assert.equal(getClientReviewStage({ human_review_status: "not_requested" }), "not_requested");
  assert.equal(getClientReviewStage({ human_review_status: null }), "not_requested");
});

test("parecer: caso concluído usa o registro finalizado mesmo havendo registro mais novo", () => {
  const completed = row({ id: "done", status: "completed", specialist_id: SPECIALIST, created_at: "2026-10-02T10:00:00.000Z" });
  const newerPending = row({ id: "newer", status: "pending", created_at: "2026-10-03T10:00:00.000Z" });
  assert.equal(pickClientReviewRow([newerPending, completed], "reviewed")?.id, "done");
  assert.equal(pickClientReviewRow([completed, newerPending], "in_review")?.id, "newer");
  assert.equal(pickClientReviewRow([], "reviewed"), null);
});

test("parecer: rascunho nunca expõe texto ao produtor", () => {
  const draft = row({ status: "in_review", specialist_id: SPECIALIST, review_text: "rascunho", technical_recommendation: "x", final_observations: "y" });
  const redacted = redactUnfinishedReview(draft);
  assert.equal(redacted.review_text, null);
  assert.equal(redacted.technical_recommendation, null);
  assert.equal(redacted.final_observations, null);

  const summary = buildClientHumanReview({ rows: [draft], humanReviewStatus: "in_review", specialistName: "Dra. Ana" });
  assert.ok(summary);
  assert.equal(summary.reviewText, null);
  assert.equal(summary.technicalRecommendation, null);
  assert.equal(summary.specialistName, null);
  assert.equal(summary.analysisStartedAt, draft.created_at);
});

test("parecer: concluído traz conclusão, recomendações, responsável, datas e não traz o id da especialista", () => {
  const request = row({ id: "req", status: "pending", created_at: "2026-10-01T09:00:00.000Z" });
  const final = row({
    id: "final",
    status: "completed",
    specialist_id: SPECIALIST,
    review_text: "Conclusão",
    technical_recommendation: "Recomendação",
    final_observations: "Ressalva",
    reviewed_at: "2026-10-04T15:00:00.000Z",
    created_at: "2026-10-02T08:00:00.000Z",
  });
  const summary = buildClientHumanReview({
    rows: [request, final],
    humanReviewStatus: "reviewed",
    activityLogs: [{ action: "Usuário editou", created_at: "2026-10-01T08:00:00.000Z" }, { action: REVIEW_REQUESTED_LOG_ACTION, created_at: "2026-10-01T09:05:00.000Z" }],
    specialistName: "  Dra. Ana  ",
  });
  assert.ok(summary);
  assert.equal(summary.reviewText, "Conclusão");
  assert.equal(summary.technicalRecommendation, "Recomendação");
  assert.equal(summary.finalObservations, "Ressalva");
  assert.equal(summary.reviewedAt, "2026-10-04T15:00:00.000Z");
  assert.equal(summary.requestedAt, "2026-10-01T09:05:00.000Z");
  assert.equal(summary.analysisStartedAt, "2026-10-02T08:00:00.000Z");
  assert.equal(summary.specialistName, "Dra. Ana");
  assert.equal(JSON.stringify(summary).includes(SPECIALIST), false);
});

test("parecer: sem log de solicitação usa a data do registro de pedido", () => {
  const request = row({ id: "req", status: "pending", created_at: "2026-10-01T09:00:00.000Z" });
  const summary = buildClientHumanReview({ rows: [request], humanReviewStatus: "waiting_review" });
  assert.equal(summary?.requestedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(buildClientHumanReview({ rows: [], humanReviewStatus: "not_requested" }), null);
});

test("parecer: registro 'completed' com caso ainda não concluído não é exibido", () => {
  const final = row({ status: "completed", specialist_id: SPECIALIST, review_text: "texto", reviewed_at: "2026-10-04T15:00:00.000Z" });
  const summary = buildClientHumanReview({ rows: [final], humanReviewStatus: "in_review" });
  assert.equal(summary?.reviewText, null);
});

test("linha do tempo reflete cada etapa", () => {
  const review = { requestedAt: "2026-10-01T09:00:00.000Z", analysisStartedAt: "2026-10-02T09:00:00.000Z", reviewedAt: "2026-10-03T09:00:00.000Z" };
  const base = { caseCreatedAt: "2026-10-01T08:00:00.000Z", hasAiAnalysis: true, review };

  const waiting = buildReviewTimeline({ ...base, stage: "waiting_review" });
  assert.deepEqual(waiting.map((step) => step.state), ["done", "done", "done", "current", "upcoming"]);
  assert.equal(waiting[3].label, "Aguardando início da análise");

  const inReview = buildReviewTimeline({ ...base, stage: "in_review" });
  assert.deepEqual(inReview.map((step) => step.state), ["done", "done", "done", "current", "upcoming"]);
  assert.equal(inReview[4].date, null);

  const done = buildReviewTimeline({ ...base, stage: "completed" });
  assert.deepEqual(done.map((step) => step.state), ["done", "done", "done", "done", "done"]);
  assert.equal(done[4].date, review.reviewedAt);

  const cancelled = buildReviewTimeline({ ...base, stage: "cancelled" });
  assert.equal(cancelled[4].state, "stopped");
  assert.equal(cancelled[4].label, "Solicitação cancelada");
});

test("textos longos viram parágrafos e listas sem perder conteúdo", () => {
  const blocks = toTextBlocks("Primeiro parágrafo\ncontinua aqui.\n\n- item 1\n- item 2\n2) item 3\nFechamento");
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "Primeiro parágrafo\ncontinua aqui." },
    { kind: "list", items: ["item 1", "item 2", "item 3"] },
    { kind: "paragraph", text: "Fechamento" },
  ]);
  assert.deepEqual(toTextBlocks("   "), []);
  assert.deepEqual(toTextBlocks(null), []);
});

test("indicador de parecer novo", () => {
  let seen = parseSeenOpinions(null);
  assert.equal(isOpinionUnseen("c1", "2026-10-03T09:00:00.000Z", seen), true);
  seen = markOpinionSeen(seen, "c1", "2026-10-03T09:00:00.000Z");
  assert.equal(isOpinionUnseen("c1", "2026-10-03T09:00:00.000Z", seen), false);
  // Nova finalização do mesmo caso volta a ser sinalizada.
  assert.equal(isOpinionUnseen("c1", "2026-10-05T09:00:00.000Z", seen), true);
  assert.deepEqual(parseSeenOpinions("{quebrado"), {});
  assert.deepEqual(parseSeenOpinions("[1,2]"), {});
  assert.deepEqual(parseSeenOpinions('{"a":"x","b":1}'), { a: "x" });
});

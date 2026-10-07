/**
 * Fluxo de rascunhos do Painel da Doutora: classificação da fila, escolha do
 * parecer atual, reaproveitamento do rascunho (sem duplicar registros),
 * restauração do formulário, validação de finalização, busca e ordenação.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_REVIEW_FORM,
  HumanReviewRow,
  getMissingFinalizeFields,
  getReviewBucket,
  isReviewFormEmpty,
  isSameReviewForm,
  matchesQueueSearch,
  pickCurrentReview,
  resolveDraftTarget,
  reviewRowToForm,
  sortQueue
} from "../lib/agronomic/review-workflow";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function row(overrides: Partial<HumanReviewRow>): HumanReviewRow {
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
    ...overrides
  };
}

const placeholder = row({ id: "placeholder", status: "pending", created_at: "2026-10-01T09:00:00.000Z" });

test("classifica o status do caso nas abas do painel", () => {
  assert.equal(getReviewBucket("waiting_review"), "pending");
  assert.equal(getReviewBucket("in_review"), "draft");
  assert.equal(getReviewBucket("reviewed"), "completed");
  assert.equal(getReviewBucket("completed"), "completed");
  assert.equal(getReviewBucket("pending_payment"), null);
  assert.equal(getReviewBucket(null), null);
});

test("rascunho salvo continua sendo o parecer atual do caso (não some da fila)", () => {
  const draft = row({ id: "draft", status: "in_review", specialist_id: ME, review_text: "Texto parcial", created_at: "2026-10-02T10:00:00.000Z" });
  assert.equal(pickCurrentReview([placeholder, draft], "in_review")?.id, "draft");
});

test("ignora o registro 'pending' criado na solicitação (sem especialista)", () => {
  assert.equal(pickCurrentReview([placeholder], "waiting_review"), null);
  assert.equal(pickCurrentReview([placeholder], "in_review"), null);
});

test("caso concluído mostra o parecer finalizado, não rascunhos antigos", () => {
  const oldDraft = row({ id: "old", status: "in_review", specialist_id: ME, created_at: "2026-10-03T10:00:00.000Z" });
  const final = row({ id: "final", status: "completed", specialist_id: ME, created_at: "2026-10-02T10:00:00.000Z" });
  assert.equal(pickCurrentReview([oldDraft, final], "reviewed")?.id, "final");
});

test("salvar de novo atualiza o mesmo rascunho (sem duplicar)", () => {
  const draft = row({ id: "draft", status: "in_review", specialist_id: ME });
  const target = resolveDraftTarget([placeholder, draft], ME, false);
  assert.equal(target.kind, "update");
  assert.equal(target.kind === "update" && target.row.id, "draft");
});

test("legado com rascunhos duplicados: atualiza o mais recente da própria especialista", () => {
  const older = row({ id: "older", status: "in_review", specialist_id: ME, created_at: "2026-10-01T10:00:00.000Z" });
  const newer = row({ id: "newer", status: "in_review", specialist_id: ME, created_at: "2026-10-04T10:00:00.000Z" });
  const target = resolveDraftTarget([older, newer], ME, false);
  assert.equal(target.kind === "update" && target.row.id, "newer");
});

test("primeiro salvamento cria um registro novo", () => {
  assert.deepEqual(resolveDraftTarget([placeholder], ME, false), { kind: "insert" });
  assert.deepEqual(resolveDraftTarget([], ME, false), { kind: "insert" });
});

test("especialista não sobrescreve rascunho de outra especialista", () => {
  const othersDraft = row({ id: "other", status: "in_review", specialist_id: OTHER });
  assert.equal(resolveDraftTarget([othersDraft], ME, false).kind, "conflict");
});

test("administrador pode assumir rascunho de outra especialista", () => {
  const othersDraft = row({ id: "other", status: "in_review", specialist_id: OTHER });
  const target = resolveDraftTarget([othersDraft], ME, true);
  assert.equal(target.kind === "update" && target.row.id, "other");
});

test("parecer finalizado não é tratado como rascunho editável", () => {
  const final = row({ id: "final", status: "completed", specialist_id: ME });
  assert.deepEqual(resolveDraftTarget([final], ME, false), { kind: "insert" });
});

test("restaura todos os campos do rascunho no formulário", () => {
  const form = reviewRowToForm(row({ review_text: "A", technical_recommendation: "B", final_observations: null }));
  assert.deepEqual(form, { reviewText: "A", technicalRecommendation: "B", finalObservations: "" });
  assert.deepEqual(reviewRowToForm(null), EMPTY_REVIEW_FORM);
});

test("detecta alterações ignorando espaços nas pontas", () => {
  const saved = { reviewText: "A", technicalRecommendation: "B", finalObservations: "" };
  assert.equal(isSameReviewForm(saved, { ...saved, reviewText: "A  " }), true);
  assert.equal(isSameReviewForm(saved, { ...saved, finalObservations: "nova" }), false);
  assert.equal(isReviewFormEmpty({ reviewText: "  ", technicalRecommendation: "", finalObservations: "\n" }), true);
});

test("finalização exige revisão técnica e recomendação técnica", () => {
  assert.deepEqual(getMissingFinalizeFields(EMPTY_REVIEW_FORM), ["reviewText", "technicalRecommendation"]);
  assert.deepEqual(getMissingFinalizeFields({ reviewText: "x", technicalRecommendation: " ", finalObservations: "" }), ["technicalRecommendation"]);
  assert.deepEqual(getMissingFinalizeFields({ reviewText: "x", technicalRecommendation: "y", finalObservations: "" }), []);
});

test("busca ignora acentos e combina cultura, cidade e propriedade", () => {
  const item = { crop: "Café", symptoms: "Manchas nas folhas", farm: { name: "Sítio Boa Vista", city: "São João", state: "MG" } };
  assert.equal(matchesQueueSearch(item, "cafe sao joao"), true);
  assert.equal(matchesQueueSearch(item, "boa vista"), true);
  assert.equal(matchesQueueSearch(item, "soja"), false);
  assert.equal(matchesQueueSearch(item, "   "), true);
});

test("ordena por envio, última alteração e risco", () => {
  const a = { crop: "a", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", risk_level: "low" };
  const b = { crop: "b", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", risk_level: "high" };
  const c = { crop: "c", created_at: "2026-10-03T12:00:00Z", updated_at: null, risk_level: "medium" };
  const crops = (items: Array<{ crop: string }>) => items.map((item) => item.crop).join("");

  assert.equal(crops(sortQueue([c, a, b], "oldest")), "abc");
  assert.equal(crops(sortQueue([a, b, c], "newest")), "cba");
  assert.equal(crops(sortQueue([b, c, a], "updated")), "acb");
  assert.equal(crops(sortQueue([a, c, b], "risk")), "bca");
});

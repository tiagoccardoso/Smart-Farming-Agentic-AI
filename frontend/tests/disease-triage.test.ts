import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_DISEASE_TRIAGE_FORM,
  buildDiseaseTriageHistory,
  validateDiseaseTriageForm,
} from "../lib/disease/triage";

test("triagem pública exige cultura, sintomas e ao menos uma foto", () => {
  const empty = validateDiseaseTriageForm(EMPTY_DISEASE_TRIAGE_FORM, 0);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.field, "crop");

  const withoutPhoto = validateDiseaseTriageForm({ crop: "Tomate", symptoms: "Manchas nas folhas" }, 0);
  assert.equal(withoutPhoto.ok, false);
  if (!withoutPhoto.ok) assert.equal(withoutPhoto.field, "photos");
});
test("campos complementares são normalizados e permanecem no histórico do caso", () => {
  const result = validateDiseaseTriageForm({
    crop: "  Tomate ",
    symptoms: "  Manchas e amarelecimento  ",
    affectedPart: "Folhas",
    symptomStartDate: "2026-10-10",
    treatmentsUsed: "Nenhum",
    additionalInfo: "Apareceu após chuva.",
  }, 1);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.crop, "Tomate");
  assert.match(buildDiseaseTriageHistory(result.value), /Origem: triagem pública de doenças/);
  assert.match(buildDiseaseTriageHistory(result.value), /Parte afetada: Folhas/);
  assert.match(buildDiseaseTriageHistory(result.value), /Tratamentos\/produtos já utilizados: Nenhum/);
});

test("data inválida é rejeitada no mesmo contrato usado pelo servidor", () => {
  const result = validateDiseaseTriageForm({ crop: "Milho", symptoms: "Lesões", symptomStartDate: "2026-02-31" }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.field, "symptomStartDate");
});

/**
 * Contrato compartilhado da triagem pública de doenças.
 *
 * Este arquivo não conhece React nem credenciais de servidor. Ele é usado pelo
 * formulário para feedback imediato e pelas rotas para a validação definitiva.
 */

export const DISEASE_TRIAGE_COOKIE = "plantasa_disease_triage_draft";
export const DISEASE_TRIAGE_DRAFT_TTL_SECONDS = 60 * 60 * 24;

const MB = 1024 * 1024;

export const DISEASE_TRIAGE_LIMITS = {
  maxImages: 4,
  maxImageBytes: 4 * MB,
  maxTotalImageBytes: 4 * MB,
  crop: 120,
  affectedPart: 80,
  symptoms: 6000,
  symptomStartDate: 10,
  symptomEvolution: 1200,
  affectedProportion: 160,
  environmentalConditions: 1600,
  treatmentsUsed: 1600,
  plantLocation: 240,
  additionalInfo: 3000,
  city: 120,
  state: 60,
  growthStage: 160,
  soilType: 160,
  history: 1600,
  submissionKey: 100,
} as const;

export const AFFECTED_PART_OPTIONS = [
  "Folhas",
  "Raízes",
  "Caule",
  "Frutos",
  "Flores",
  "Planta inteira",
  "Outra parte",
] as const;

export type DiseaseTriageForm = {
  crop: string;
  affectedPart: string;
  symptoms: string;
  symptomStartDate: string;
  symptomEvolution: string;
  affectedProportion: string;
  environmentalConditions: string;
  treatmentsUsed: string;
  plantLocation: string;
  additionalInfo: string;
  city: string;
  state: string;
  growthStage: string;
  soilType: string;
  history: string;
};

export type DiseaseTriageField = keyof DiseaseTriageForm;

export const EMPTY_DISEASE_TRIAGE_FORM: DiseaseTriageForm = {
  crop: "",
  affectedPart: "",
  symptoms: "",
  symptomStartDate: "",
  symptomEvolution: "",
  affectedProportion: "",
  environmentalConditions: "",
  treatmentsUsed: "",
  plantLocation: "",
  additionalInfo: "",
  city: "",
  state: "",
  growthStage: "",
  soilType: "",
  history: "",
};

export type DiseaseTriageValidation =
  | { ok: true; value: DiseaseTriageForm }
  | { ok: false; field: DiseaseTriageField | "photos"; message: string };

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}
function validIsoDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateDiseaseTriageForm(input: Partial<Record<DiseaseTriageField, unknown>>, imageCount: number): DiseaseTriageValidation {
  const value = Object.fromEntries(
    (Object.keys(EMPTY_DISEASE_TRIAGE_FORM) as DiseaseTriageField[]).map((field) => [
      field,
      clean(input[field], DISEASE_TRIAGE_LIMITS[field]),
    ]),
  ) as DiseaseTriageForm;

  if (!value.crop) return { ok: false, field: "crop", message: "Informe o nome da planta ou cultura." };
  if (!value.symptoms) return { ok: false, field: "symptoms", message: "Descreva os sintomas observados." };
  if (!validIsoDate(value.symptomStartDate)) return { ok: false, field: "symptomStartDate", message: "Informe uma data válida ou deixe este campo em branco." };
  if (imageCount < 1) return { ok: false, field: "photos", message: "Adicione pelo menos uma fotografia da planta ou da parte afetada." };
  if (imageCount > DISEASE_TRIAGE_LIMITS.maxImages) return { ok: false, field: "photos", message: `Envie no máximo ${DISEASE_TRIAGE_LIMITS.maxImages} fotografias.` };

  return { ok: true, value };
}

/**
 * Mantém os campos complementares no mesmo conteúdo já usado pelo caso e pela
 * IA. Assim eles continuam visíveis na tela de detalhes e editáveis no campo
 * de histórico, sem criar um segundo modelo de caso paralelo.
 */
export function buildDiseaseTriageHistory(form: DiseaseTriageForm) {
  const entries = [
    ["Parte afetada", form.affectedPart],
    ["Início aproximado", form.symptomStartDate],
    ["Evolução", form.symptomEvolution],
    ["Proporção afetada", form.affectedProportion],
    ["Condições ambientais", form.environmentalConditions],
    ["Tratamentos/produtos já utilizados", form.treatmentsUsed],
    ["Localização da planta", form.plantLocation],
    ["Cidade", form.city],
    ["Estado", form.state],
    ["Estágio da cultura", form.growthStage],
    ["Tipo de solo", form.soilType],
    ["Histórico adicional", form.history],
    ["Informações adicionais", form.additionalInfo],
  ].filter(([, entry]) => Boolean(entry));

  return entries.length
    ? `Origem: triagem pública de doenças.\n${entries.map(([label, entry]) => `${label}: ${entry}`).join("\n")}`
    : "Origem: triagem pública de doenças.";
}

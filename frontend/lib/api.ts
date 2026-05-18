import { getStoredSupabaseAccessToken } from "./supabaseAuth";

export type CropPayload = {
  N: number;
  P: number;
  K: number;
  temperature: number;
  humidity: number;
  ph: number;
  rainfall: number;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "A solicitação não pôde ser concluída.");
  }

  return payload;
}

function getOptionalAuthHeaders(): Record<string, string> {
  const token = getStoredSupabaseAccessToken();

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function recommendCrop(payload: CropPayload) {
  const response = await fetch("/api/crop/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseResponse(response);
}

export type DiseaseTriagePayload = {
  file: File;
  crop: string;
  symptoms: string;
  state: string;
  city?: string;
  growthStage?: string;
  soilType?: string;
  history?: string;
};

export async function detectDisease(payload: DiseaseTriagePayload) {
  const formData = new FormData();
  formData.append("file", payload.file);
  formData.append("crop", payload.crop);
  formData.append("symptoms", payload.symptoms);
  formData.append("state", payload.state);
  if (payload.city) formData.append("city", payload.city);
  if (payload.growthStage) formData.append("growthStage", payload.growthStage);
  if (payload.soilType) formData.append("soilType", payload.soilType);
  if (payload.history) formData.append("history", payload.history);

  const response = await fetch("/api/disease/predict", {
    method: "POST",
    headers: getOptionalAuthHeaders(),
    body: formData
  });

  return parseResponse(response);
}

export async function askQuestion(question: string) {
  const response = await fetch("/api/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getOptionalAuthHeaders() },
    body: JSON.stringify({ question })
  });

  return parseResponse(response);
}



export async function getQuestionHistory() {
  const response = await fetch("/api/qa", {
    method: "GET",
    headers: getOptionalAuthHeaders()
  });

  return parseResponse(response);
}

export async function submitAgronomicCase(formData: FormData, accessToken: string) {
  const response = await fetch("/api/agronomic-cases", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData
  });

  return parseResponse(response);
}

export async function getAgronomicCases(accessToken: string) {
  const response = await fetch("/api/agronomic-cases", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseResponse(response);
}

export async function getAgronomicCase(caseId: string, accessToken: string) {
  const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseResponse(response);
}

export async function analyzeAgronomicCase(caseId: string, accessToken: string, question?: string) {
  const response = await fetch("/api/agronomic-ai/analyze-case", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ caseId, question })
  });

  const payload = await parseResponse(response);
  return payload?.analysis ? payload : { analysis: payload };
}

export async function requestHumanReviewCheckout(caseId: string, accessToken: string, serviceType = "human_case_review") {
  const response = await fetch("/api/stripe/create-human-review-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ caseId, serviceType })
  });

  return parseResponse(response);
}

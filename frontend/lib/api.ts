import { getStoredSupabaseAccessToken } from "./supabaseAuth";

export type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      fieldErrors?: Record<string, string>;
    },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
  }
}

function isTechnicalMessage(message: string) {
  return /NEXT_PUBLIC_|SUPABASE_|SERVICE_ROLE|JWT|secret|token|apikey/i.test(
    message,
  );
}

function fallbackErrorMessage(status: number) {
  if (status === 400) return "Revise os dados informados e tente novamente.";
  if (status === 401)
    return "Sua sessão expirou. Faça login novamente para continuar.";
  if (status === 402) return "Seu plano atual não permite concluir esta ação.";
  if (status === 403) return "Você não tem permissão para concluir esta ação.";
  if (status === 404) return "O registro solicitado não foi encontrado.";
  if (status === 409)
    return "Há um conflito com os dados enviados. Revise as informações e tente novamente.";
  if (status >= 500)
    return "O serviço encontrou uma instabilidade temporária. Tente novamente em instantes.";
  return "A solicitação não pôde ser concluída.";
}

async function readJsonPayload<T = unknown>(
  response: Response,
): Promise<T | null> {
  const text = await response.text().catch(() => "");

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export type CropPayload = {
  N: number;
  P: number;
  K: number;
  temperature: number;
  humidity: number;
  ph: number;
  rainfall: number;
};

async function parseResponse<T = any>(response: Response): Promise<T> {
  const payload = await readJsonPayload<ApiErrorPayload>(response);

  if (!response.ok) {
    const serverMessage = payload?.error || payload?.message || "";
    const safeMessage =
      serverMessage && !isTechnicalMessage(serverMessage)
        ? serverMessage
        : fallbackErrorMessage(response.status);

    throw new ApiRequestError(safeMessage, {
      status: response.status,
      code: payload?.code,
      fieldErrors: payload?.fieldErrors,
    });
  }

  return payload as T;
}

function getOptionalAuthHeaders(): Record<string, string> {
  const token = getStoredSupabaseAccessToken();

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function recommendCrop(payload: CropPayload) {
  const response = await fetch("/api/crop/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
    body: formData,
  });

  return parseResponse(response);
}

export async function askQuestion(question: string) {
  const response = await fetch("/api/qa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getOptionalAuthHeaders(),
    },
    body: JSON.stringify({ question }),
  });

  return parseResponse(response);
}

export async function getQuestionHistory() {
  const response = await fetch("/api/qa", {
    method: "GET",
    headers: getOptionalAuthHeaders(),
  });

  return parseResponse(response);
}

export async function submitAgronomicCase(
  formData: FormData,
  accessToken: string,
) {
  const response = await fetch("/api/agronomic-cases", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  return parseResponse(response);
}

export async function updateAgronomicCase(
  caseId: string,
  formData: FormData,
  accessToken: string,
) {
  const response = await fetch(
    `/api/agronomic-cases/${encodeURIComponent(caseId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    },
  );

  return parseResponse(response);
}

export async function deleteAgronomicCase(caseId: string, accessToken: string) {
  const response = await fetch(
    `/api/agronomic-cases/${encodeURIComponent(caseId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  return parseResponse(response);
}

export async function getAgronomicCases(accessToken: string) {
  const response = await fetch("/api/agronomic-cases", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return parseResponse(response);
}

export async function getAgronomicCase(caseId: string, accessToken: string) {
  const response = await fetch(
    `/api/agronomic-cases/${encodeURIComponent(caseId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  return parseResponse(response);
}

export async function analyzeAgronomicCase(
  caseId: string,
  accessToken: string,
  question?: string,
) {
  const response = await fetch("/api/agronomic-ai/analyze-case", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ caseId, question }),
  });

  const payload = await parseResponse(response);
  return payload?.analysis ? payload : { analysis: payload };
}

export async function requestHumanReviewCheckout(
  caseId: string,
  accessToken: string,
  serviceType = "human_case_review",
) {
  const response = await fetch("/api/stripe/create-human-review-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ caseId, serviceType }),
  });

  return parseResponse(response);
}

import { NextResponse } from "next/server";
import {
  fetchAgronomicCase,
  generateAgronomicPreAnalysis,
  getAuthenticatedUser,
  getSupabaseConfig,
  getCurrentPendingQuestion,
  insertCaseChatMessage,
  logPendingQuestionSync,
  replaceCasePendingQuestions,
  supabaseRequest,
  syncAnalysisMissingQuestionsWithPendingQueue,
  updateAgronomicCaseWithAnalysis,
  type AgronomicPreAnalysis,
} from "../../../../lib/agronomic/case";
import {
  PLAN_LIMIT_REACHED_MESSAGE,
  PlanLimitExceededError,
  assertPlanLimit,
  recordUsageEvent,
} from "../../../../lib/billing/check-plan-limits";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const ACCEPTED_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
];
const GENERIC_MOBILE_FILE_TYPES = ["", "application/octet-stream"];
const DISEASE_TRIAGE_DISCLAIMER =
  "Esta análise é uma triagem orientativa gerada por IA e não substitui avaliação de profissional habilitado.";

class FriendlyRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  const value = requiredText(formData, key);
  return value.length > 0 ? value : null;
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function sanitizeFileName(fileName: string) {
  return (
    fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "imagem"
  );
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getNormalizedFileType(file: File) {
  const normalizedType = file.type.toLowerCase();

  if (normalizedType && normalizedType !== "application/octet-stream") {
    return normalizedType;
  }

  const extension = getFileExtension(file.name);
  const typeByExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };

  return typeByExtension[extension] ?? normalizedType;
}

function isAllowedMobileImage(file: File) {
  const extension = getFileExtension(file.name);
  const hasAllowedExtension = ACCEPTED_IMAGE_EXTENSIONS.includes(extension);
  const normalizedType = file.type.toLowerCase();
  const inferredType = getNormalizedFileType(file);

  if (
    ACCEPTED_IMAGE_TYPES.includes(normalizedType) ||
    ACCEPTED_IMAGE_TYPES.includes(inferredType)
  ) {
    return true;
  }

  return hasAllowedExtension && GENERIC_MOBILE_FILE_TYPES.includes(normalizedType);
}

function validateImage(file: File) {
  if (!isAllowedMobileImage(file)) {
    throw new FriendlyRequestError("Envie uma imagem JPG, PNG, WEBP, HEIC ou HEIF da planta.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new FriendlyRequestError("A imagem excede o limite de 10MB.");
  }
}

async function uploadToStorage(file: File, path: string, token: string) {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": getNormalizedFileType(file) || "application/octet-stream",
      "x-upsert": "false",
    },
    body: Buffer.from(await file.arrayBuffer()),
    cache: "no-store",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Não foi possível enviar a imagem.");
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

function inferConfidenceLevel(analysis: AgronomicPreAnalysis) {
  const questionCount = analysis.missingQuestions.length;

  if (analysis.riskLevel === "low" && questionCount <= 2) {
    return "high";
  }

  if (analysis.riskLevel === "high" || questionCount >= 5) {
    return "low";
  }

  return "medium";
}

function buildStructuredDiseaseAnalysis(analysis: AgronomicPreAnalysis) {
  const confidenceLevel = inferConfidenceLevel(analysis);
  const probableDiseases = analysis.probableHypotheses.map((hypothesis) => ({
    name: hypothesis,
    evidence: "Hipótese gerada a partir da imagem, sintomas, cultura, contexto de solo/clima e base agronômica disponível.",
  }));
  const possibleCauses = [
    "Condição favorecida por clima, umidade, manejo, solo, nutrição ou pressão de pragas/doenças da cultura selecionada.",
    "A distribuição no talhão, o histórico recente de irrigação/chuva/pulverização e novas imagens podem alterar as hipóteses.",
  ];
  const initialRecommendations = analysis.initialRecommendation
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    initialDiagnosis: analysis.initialDiagnosis,
    probableDiseases,
    confidenceLevel,
    riskLevel: analysis.riskLevel,
    possibleCauses,
    missingQuestions: analysis.missingQuestions,
    initialRecommendations: initialRecommendations.length ? initialRecommendations : [analysis.initialRecommendation],
    productionImpact:
      analysis.riskLevel === "high"
        ? "Há possibilidade de perda econômica relevante se a evolução for rápida, generalizada ou associada a praga/doença agressiva. Priorize validação humana."
        : analysis.riskLevel === "medium"
          ? "Pode haver impacto produtivo se o problema avançar no talhão ou coincidir com fase sensível da cultura; monitore a evolução e complete as informações faltantes."
          : "Impacto produtivo inicialmente baixo, desde que os sintomas permaneçam localizados e sem progressão.",
    whenToCallHumanSpecialist: analysis.whenToCallHumanSpecialist,
    disclaimer: DISEASE_TRIAGE_DISCLAIMER,
    knowledgeUsed: analysis.knowledgeUsed,
  };
}

export async function POST(request: Request) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json({ success: false, error: "Faça login para usar a triagem inteligente por imagem." }, { status: 401 });
    }

    const user = await getAuthenticatedUser(token);
    const formData = await request.formData();
    const filesFromPayload = formData.getAll("files").filter(isFile);
    const legacyFile = formData.get("file");
    const files = filesFromPayload.length
      ? filesFromPayload
      : isFile(legacyFile)
        ? [legacyFile]
        : [];
    const crop = requiredText(formData, "crop");
    const symptoms = requiredText(formData, "symptoms");
    const state = requiredText(formData, "state") || "Não informado";
    const city = optionalText(formData, "city");
    const growthStage = optionalText(formData, "growthStage");
    const soilType = optionalText(formData, "soilType");
    const history = optionalText(formData, "history");

    if (!crop || !symptoms || files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Envie ao menos uma foto, cultura e sintomas para iniciar a triagem agronômica." },
        { status: 400 },
      );
    }

    files.forEach(validateImage);
    await assertPlanLimit(user.id, "image_triage");

    const farmRows = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/farms?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          name: "Triagem de doenças por imagem",
          city,
          state,
          soil_type: soilType,
        }),
      },
      token,
    );
    const farm = farmRows[0];

    const caseRows = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/agronomic_cases?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          farm_id: farm?.id ?? null,
          crop,
          growth_stage: growthStage,
          symptoms,
          history: history
            ? `${history}\nOrigem do caso: triagem inteligente por imagem na página de doenças.`
            : "Origem do caso: triagem inteligente por imagem na página de doenças.",
          status: "submitted",
        }),
      },
      token,
    );
    const createdCase = caseRows[0];

    const uploadedImages = await Promise.all(
      files.map(async (file, index) => {
        const imagePath = `${user.id}/${createdCase.id}/disease-triage/${Date.now()}-${index}-${sanitizeFileName(file.name)}`;
        const imageUrl = await uploadToStorage(file, imagePath, token);
        return {
          imageUrl,
          imageType:
            index === 0
              ? "disease_triage_initial_image"
              : "disease_triage_additional_image",
        };
      }),
    );
    const imageUrl = uploadedImages[0]?.imageUrl;

    await supabaseRequest(
      "/rest/v1/case_images",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          uploadedImages.map((image) => ({
            case_id: createdCase.id,
            user_id: user.id,
            image_url: image.imageUrl,
            image_type: image.imageType,
          })),
        ),
      },
      token,
    );

    const caseData = await fetchAgronomicCase(createdCase.id, token);
    if (!caseData) {
      throw new Error("Caso criado, mas não foi possível recarregar os dados para análise.");
    }

    const imagePrompt = [
      `Triagem multimodal de doença agrícola com ${uploadedImages.length} imagem(ns) anexada(s).`,
      "Avalie visualmente manchas, coloração, textura, necrose, deformações, fungos, pragas visíveis, padrão das folhas, caule, frutos e estágio provável da infecção.",
      "Cruze imagem, cultura, sintomas, localização, estágio, solo, clima ideal da cultura, doenças comuns, pragas recorrentes e histórico.",
      "Faça perguntas pendentes em ordem de prioridade para a conversa continuar uma pergunta por vez.",
    ].join("\n");
    const modelAnalysis = await generateAgronomicPreAnalysis(caseData, imagePrompt, token);
    const pendingQuestions = await replaceCasePendingQuestions(createdCase.id, modelAnalysis.missingQuestions, token).catch(() => []);
    logPendingQuestionSync({
      scope: "disease-predict-initial",
      aiMissingQuestions: modelAnalysis.missingQuestions,
      questions: pendingQuestions,
    });
    const analysis = syncAnalysisMissingQuestionsWithPendingQueue(
      modelAnalysis,
      pendingQuestions,
    );
    await updateAgronomicCaseWithAnalysis(createdCase.id, token, analysis);
    const structuredAnalysis = buildStructuredDiseaseAnalysis(analysis);

    await supabaseRequest(
      "/rest/v1/disease_image_analyses",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          case_id: createdCase.id,
          image_url: imageUrl,
          ai_analysis: structuredAnalysis,
          confidence_level: structuredAnalysis.confidenceLevel,
          risk_level: structuredAnalysis.riskLevel,
        }),
      },
      token,
    ).catch((error) => console.warn("Não foi possível registrar disease_image_analyses.", error));

    const currentQuestion = getCurrentPendingQuestion(pendingQuestions);
    const assistantIntro = "Triagem visual concluída. Vamos continuar como uma consulta agrícola: farei apenas uma pergunta pendente por vez.";

    await insertCaseChatMessage(
      {
        caseId: createdCase.id,
        userId: user.id,
        role: "assistant",
        message: currentQuestion ? `${assistantIntro}\n\n${currentQuestion.question}` : assistantIntro,
      },
      token,
    ).catch(() => null);
    await recordUsageEvent(user.id, "image_triage");

    return NextResponse.json({
      success: true,
      data: {
        caseId: createdCase.id,
        imageUrl,
        imageUrls: uploadedImages.map((image) => image.imageUrl),
        analysis: structuredAnalysis,
        agronomicAnalysis: analysis,
        pendingQuestions,
        currentQuestion,
      },
    });
  } catch (error) {
    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json({ success: false, error: PLAN_LIMIT_REACHED_MESSAGE }, { status: error.status });
    }

    const status = error instanceof FriendlyRequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Não foi possível analisar a imagem.";
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

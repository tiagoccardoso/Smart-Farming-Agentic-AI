import { NextRequest, NextResponse } from "next/server";
import {
  answerCurrentPendingQuestion,
  fetchAgronomicCase,
  fetchCaseChatMessages,
  fetchCasePendingQuestions,
  generateAgronomicPreAnalysis,
  getAuthenticatedUser,
  getCurrentPendingQuestion,
  getSupabaseConfig,
  insertCaseChatMessage,
  supabaseRequest,
  updateAgronomicCaseWithAnalysis,
  type CaseChatMessageType,
} from "../../../../../lib/agronomic/case";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_AUDIO_TYPES = [
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
];
const ACCEPTED_AUDIO_EXTENSIONS = ["webm", "mp3", "wav"];

type RouteContext = { params: { caseId: string } };

class FriendlyRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getToken(request: NextRequest) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null
  );
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
      .toLowerCase() || "arquivo"
  );
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateUploadFile(
  file: File,
  allowedTypes: string[],
  allowedExtensions: string[],
  maxSize: number,
  label: string,
) {
  const extension = getFileExtension(file.name);

  if (
    !allowedTypes.includes(file.type) ||
    !allowedExtensions.includes(extension)
  ) {
    throw new FriendlyRequestError(`${label} em formato inválido.`);
  }

  if (file.size > maxSize) {
    throw new FriendlyRequestError(`${label} excede o limite permitido.`);
  }
}

async function uploadToStorage(file: File, path: string, token: string) {
  const config = getSupabaseConfig();
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: Buffer.from(await file.arrayBuffer()),
      cache: "no-store",
    },
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        "Não foi possível enviar o arquivo.",
    );
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function attachImageToCase(
  caseId: string,
  userId: string,
  imageUrl: string,
  imageType: string,
  token: string,
) {
  await supabaseRequest(
    "/rest/v1/case_images",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        case_id: caseId,
        user_id: userId,
        image_url: imageUrl,
        image_type: imageType,
      }),
    },
    token,
  );
}

async function transcribeAudio(file: File) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return "Transcrição automática indisponível neste ambiente. O áudio foi salvo e deve ser revisado manualmente ou transcrito quando a API estiver configurada.";
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "audio.webm");
  formData.append(
    "model",
    process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
  );
  formData.append("language", "pt");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "Não foi possível transcrever o áudio.",
    );
  }

  return (
    String(payload?.text || "").trim() ||
    "Áudio recebido, mas a transcrição retornou vazia."
  );
}

function buildContextMessage(input: {
  text: string;
  messageType: CaseChatMessageType;
  fileUrl?: string | null;
}) {
  if (input.messageType === "image") {
    return `Nova imagem enviada pelo usuário durante a conversa. URL: ${input.fileUrl}. Observação do usuário: ${input.text}`;
  }

  if (input.messageType === "audio" || input.messageType === "transcription") {
    return `Resposta por áudio transcrita durante a conversa: ${input.text}`;
  }

  return input.text;
}

async function generateAssistantTurn(
  caseId: string,
  userId: string,
  token: string,
  userContext: string,
) {
  const pendingState = await answerCurrentPendingQuestion(
    caseId,
    userContext,
    token,
  ).catch(() => ({
    answered: null,
    next: null,
  }));
  const refreshedCase = await fetchAgronomicCase(caseId, token);
  const [conversationMessages, pendingQuestions] = await Promise.all([
    fetchCaseChatMessages(caseId, token).catch(() => []),
    fetchCasePendingQuestions(caseId, token).catch(() => []),
  ]);
  const answeredContext = pendingQuestions
    .filter((question) => question.status === "answered")
    .map(
      (question) =>
        `Pergunta respondida: ${question.question} Resposta: ${question.answer ?? "não registrada"}`,
    )
    .join("\n");
  const conversationContext = conversationMessages
    .slice(-16)
    .map(
      (message) =>
        `${message.role === "assistant" ? "IA" : "Usuário"} (${message.message_type}): ${message.message}`,
    )
    .join("\n");
  const analysisQuestion = [
    "Contexto acumulado da conversa deste caseId:",
    conversationContext || "Sem mensagens anteriores.",
    answeredContext || "Sem perguntas pendentes respondidas ainda.",
    "Nova entrada do usuário:",
    userContext,
  ].join("\n");
  const analysis = await generateAgronomicPreAnalysis(
    refreshedCase!,
    analysisQuestion,
    token,
  );
  await updateAgronomicCaseWithAnalysis(caseId, token, analysis);

  let nextQuestion = pendingState.next;
  if (!nextQuestion) {
    const pendingQuestions = await fetchCasePendingQuestions(
      caseId,
      token,
    ).catch(() => []);
    nextQuestion = getCurrentPendingQuestion(pendingQuestions);
  }

  const assistantText = nextQuestion
    ? `${analysis.conversationalAnswer?.trim() || "Entendi. Vou atualizar o contexto e avançar para a próxima pergunta pendente."}\n\n${nextQuestion.question}`
    : analysis.conversationalAnswer ||
      "Informação registrada no caso. Continue enviando detalhes, fotos ou áudio se os sintomas evoluírem; para decisões de manejo com risco, solicite revisão humana.";

  const assistantMessage = await insertCaseChatMessage(
    { caseId, userId, role: "assistant", message: assistantText },
    token,
  );

  return {
    analysis,
    assistantMessage,
    currentQuestion: nextQuestion,
    answeredQuestion: pendingState.answered,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para carregar o chat do caso." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(context.params.caseId, token);

    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Caso não encontrado ou sem permissão." },
        { status: 404 },
      );
    }

    const [messages, pendingQuestions] = await Promise.all([
      fetchCaseChatMessages(context.params.caseId, token),
      fetchCasePendingQuestions(context.params.caseId, token).catch(() => []),
    ]);
    return NextResponse.json({
      messages,
      pendingQuestions,
      currentQuestion: getCurrentPendingQuestion(pendingQuestions),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar o chat.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para registrar mensagens no chat." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(context.params.caseId, token);

    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Caso não encontrado ou sem permissão." },
        { status: 404 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let text = "";
    let messageType: CaseChatMessageType = "text";
    let fileUrl: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const requestedType = String(
        formData.get("messageType") || "text",
      ) as CaseChatMessageType;
      text = String(formData.get("message") || "").trim();

      if (isFile(file)) {
        const safeName = sanitizeFileName(file.name);
        const suffix = `${Date.now()}-${safeName}`;

        if (requestedType === "image") {
          validateUploadFile(
            file,
            ACCEPTED_IMAGE_TYPES,
            ACCEPTED_IMAGE_EXTENSIONS,
            MAX_IMAGE_SIZE_BYTES,
            "Imagem",
          );
          const path = `${user.id}/${context.params.caseId}/chat/images/${suffix}`;
          fileUrl = await uploadToStorage(file, path, token);
          await attachImageToCase(
            context.params.caseId,
            user.id,
            fileUrl,
            "chat_image",
            token,
          );
          messageType = "image";
          text = text || "Nova imagem enviada pelo usuário durante a conversa.";
        } else if (requestedType === "audio") {
          validateUploadFile(
            file,
            ACCEPTED_AUDIO_TYPES,
            ACCEPTED_AUDIO_EXTENSIONS,
            MAX_AUDIO_SIZE_BYTES,
            "Áudio",
          );
          const path = `${user.id}/${context.params.caseId}/chat/audio/${suffix}`;
          fileUrl = await uploadToStorage(file, path, token);
          messageType = "audio";
          text = await transcribeAudio(file);
        }
      }
    } else {
      const payload = (await request.json().catch(() => null)) as {
        message?: string;
      } | null;
      text = payload?.message?.trim() || "";
    }

    if (!text && !fileUrl) {
      return NextResponse.json(
        { error: "Informe uma mensagem, foto ou áudio válido." },
        { status: 400 },
      );
    }

    const userMessage = await insertCaseChatMessage(
      {
        caseId: context.params.caseId,
        userId: user.id,
        role: "user",
        message: text,
        messageType,
        fileUrl,
      },
      token,
    );
    const aiTurn = await generateAssistantTurn(
      context.params.caseId,
      user.id,
      token,
      buildContextMessage({ text, messageType, fileUrl }),
    );

    return NextResponse.json({ userMessage, ...aiTurn });
  } catch (error) {
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível salvar a mensagem.";
    return NextResponse.json({ error: message }, { status });
  }
}

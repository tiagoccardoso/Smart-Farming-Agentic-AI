import { NextRequest, NextResponse } from "next/server";
import {
  answerCurrentPendingQuestion,
  fetchAgronomicCase,
  fetchCaseChatMessages,
  fetchCasePendingQuestions,
  generateAgronomicPreAnalysis,
  getAuthenticatedUser,
  getCurrentPendingQuestion,
  logPendingQuestionSync,
  syncAnalysisMissingQuestionsWithPendingQueue,
  insertCaseChatMessage,
  supabaseRequest,
  updateAgronomicCaseWithAnalysis,
  type AgronomicCaseChatMessage,
} from "../../../../../lib/agronomic/case";
import {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  CASE_ATTACHMENT_LIMITS,
  MAX_REQUEST_BODY_BYTES,
  PHOTO_EXTENSIONS,
  PHOTO_MIME_TYPES,
  buildCaseAttachmentPath,
  isValidClientUploadId,
} from "../../../../../lib/agronomic/case-attachments";
import {
  AUDIO_MESSAGE_LABEL,
  IMAGE_MESSAGE_LABEL,
  buildUserTurnContext,
  trailingUserMessages,
  type ChatMessageRow,
} from "../../../../../lib/agronomic/case-chat";
import {
  PLAN_LIMIT_REACHED_MESSAGE,
  PlanLimitExceededError,
  UserInactiveError,
  assertPlanLimit,
  recordUsageEvent,
} from "../../../../../lib/billing/check-plan-limits";
import { isAllowedUploadFile } from "../../../../../lib/mobile-image-upload";
import { CaseEditError, deleteCaseObjects, uploadCaseObject } from "../../../../../lib/server/agronomic-case-edit";

export const maxDuration = 60;

type RouteContext = { params: { caseId: string } };

type TranscriptionStatus = "success" | "failed" | "unavailable";

class FriendlyRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeAudioMime(type: string) {
  const base = type.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-m4a" || base === "audio/m4a" || base === "audio/aac") return "audio/mp4";
  if (base === "audio/mp3") return "audio/mpeg";
  if (base === "audio/x-wav") return "audio/wav";
  return base;
}

const AUDIO_TYPE_BY_EXTENSION: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/**
 * Tipo de conteúdo do áudio para o storage. Navegadores rotulam arquivos .webm
 * e .m4a como "video/*" no seletor de arquivos; o bucket aceita só "audio/*".
 */
function resolveAudioContentType(file: File) {
  const type = normalizeAudioMime(file.type || "");
  if (type === "video/webm") return "audio/webm";
  if (type === "video/mp4") return "audio/mp4";
  if (type.startsWith("audio/")) return type;
  return AUDIO_TYPE_BY_EXTENSION[getFileExtension(file.name)] ?? "audio/webm";
}

function isAllowedAudio(file: File) {
  const type = normalizeAudioMime(file.type || "");
  if (AUDIO_MIME_TYPES.map(normalizeAudioMime).includes(type)) return true;
  const genericType = !type || type === "application/octet-stream" || type === "video/webm" || type === "video/mp4";
  return genericType && AUDIO_EXTENSIONS.includes(getFileExtension(file.name));
}

async function transcribeAudio(file: File): Promise<{ status: TranscriptionStatus; text: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "unavailable", text: null };

  try {
    const formData = new FormData();
    formData.append("file", file, file.name || "audio.webm");
    formData.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
    formData.append("language", "pt");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const payload = await response.json().catch(() => null);
    const text = String(payload?.text || "").trim();

    if (!response.ok || !text) {
      console.warn("[case-chat] transcrição não concluída", { status: response.status });
      return { status: "failed", text: null };
    }
    return { status: "success", text };
  } catch (error) {
    console.warn("[case-chat] transcrição falhou", { message: error instanceof Error ? error.message : String(error) });
    return { status: "failed", text: null };
  }
}

async function attachImageToCase(caseId: string, userId: string, imageUrl: string, imageType: string, token: string) {
  const existing = await supabaseRequest<Array<{ id: string }>>(
    `/rest/v1/case_images?case_id=eq.${encodeURIComponent(caseId)}&image_url=eq.${encodeURIComponent(imageUrl)}&select=id&limit=1`,
    { method: "GET" },
    token,
  ).catch(() => []);
  if (existing.length) return;
  await supabaseRequest(
    "/rest/v1/case_images",
    {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ case_id: caseId, user_id: userId, image_url: imageUrl, image_type: imageType }),
    },
    token,
  );
}

async function generateAssistantTurn(caseId: string, userId: string, token: string, userContext: string) {
  const pendingState = await answerCurrentPendingQuestion(caseId, userContext, token).catch(() => ({ answered: null, next: null }));
  const refreshedCase = await fetchAgronomicCase(caseId, token);
  const [conversationMessages, pendingQuestions] = await Promise.all([
    fetchCaseChatMessages(caseId, token).catch(() => []),
    fetchCasePendingQuestions(caseId, token).catch(() => []),
  ]);
  const answeredContext = pendingQuestions
    .filter((question) => question.status === "answered")
    .map((question) => `Pergunta respondida: ${question.question} Resposta: ${question.answer ?? "não registrada"}`)
    .join("\n");
  const conversationContext = conversationMessages
    .slice(-16)
    .map((message) => `${message.role === "assistant" ? "IA" : "Usuário"} (${message.message_type}): ${message.message}`)
    .join("\n");
  const pendingCount = pendingQuestions.filter((question) => question.status === "pending").length;
  const analysisQuestion = [
    "Contexto acumulado da conversa deste caseId:",
    conversationContext || "Sem mensagens anteriores.",
    answeredContext || "Sem perguntas pendentes respondidas ainda.",
    `Estado oficial da fila no banco: pendingQuestions.length === ${pendingCount}. Perguntas pendentes oficiais restantes: ${pendingCount}.`,
    "Se pendingQuestions.length === 0, não gere novas missingQuestions; conclua a triagem com limitação natural se necessário.",
    "Nova entrada do usuário:",
    userContext,
  ].join("\n");
  const modelAnalysis = await generateAgronomicPreAnalysis(refreshedCase!, analysisQuestion, token);
  const syncedPendingQuestions = await fetchCasePendingQuestions(caseId, token).catch(() => pendingQuestions);
  logPendingQuestionSync({
    scope: "agronomic-case-chat-post",
    aiMissingQuestions: modelAnalysis.missingQuestions,
    questions: syncedPendingQuestions,
  });
  const analysis = await updateAgronomicCaseWithAnalysis(
    caseId,
    token,
    syncAnalysisMissingQuestionsWithPendingQueue(modelAnalysis, syncedPendingQuestions),
    { source: "chat" },
  );

  const nextQuestion = getCurrentPendingQuestion(syncedPendingQuestions);
  const assistantText = nextQuestion
    ? `${analysis.conversationalAnswer?.trim() || "Entendi. Vou atualizar o contexto e avançar para a próxima pergunta pendente."}\n\n${nextQuestion.question}`
    : analysis.conversationalAnswer?.trim() ||
      "Com as informações fornecidas, a triagem inicial foi concluída. Ainda pode existir alguma incerteza natural devido às limitações da análise remota, mas no momento não há perguntas pendentes obrigatórias. " +
        (analysis.riskLevel === "medium" || analysis.riskLevel === "high"
          ? "Como há risco ou incerteza relevante, recomendo revisão humana antes de decisões de manejo importantes."
          : "Mantenha o monitoramento e solicite revisão humana se os sintomas evoluírem ou houver decisão de manejo relevante.");

  const assistantMessage = await insertCaseChatMessage({ caseId, userId, role: "assistant", message: assistantText }, token);

  return {
    analysis,
    assistantMessage,
    currentQuestion: nextQuestion,
    answeredQuestion: pendingState.answered,
    pendingQuestions: syncedPendingQuestions,
  };
}

async function loadOwnedCase(request: NextRequest, caseId: string) {
  const token = getToken(request);
  if (!token) throw new FriendlyRequestError("Faça login para usar o chat do caso.", 401, "AUTH_REQUIRED");
  const user = await getAuthenticatedUser(token).catch(() => {
    throw new FriendlyRequestError("Sua sessão expirou. Faça login novamente.", 401, "AUTH_REQUIRED");
  });
  const caseData = await fetchAgronomicCase(caseId, token);
  // Cada conversa pertence a um único caso e ao dono do caso.
  if (!caseData || caseData.user_id !== user.id) {
    throw new FriendlyRequestError("Caso não encontrado ou sem permissão.", 404, "NOT_FOUND");
  }
  return { token, user, caseData };
}

function errorResponse(error: unknown) {
  if (error instanceof PlanLimitExceededError) {
    return NextResponse.json({ error: error.message || PLAN_LIMIT_REACHED_MESSAGE, code: "PLAN_LIMIT_REACHED", cta: error.result?.cta ?? null }, { status: 402 });
  }
  if (error instanceof UserInactiveError) {
    return NextResponse.json({ error: error.message, code: "USER_INACTIVE" }, { status: 403 });
  }
  if (error instanceof FriendlyRequestError || error instanceof CaseEditError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[case-chat] falha inesperada", { message: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "Não foi possível processar a mensagem agora. Tente novamente.", code: "UNEXPECTED" }, { status: 500 });
}

async function runAssistantTurnSafely(caseId: string, userId: string, token: string, context: string) {
  try {
    const turn = await generateAssistantTurn(caseId, userId, token, context);
    await recordUsageEvent(userId, "ai_question").catch(() => null);
    return { turn, aiError: null as string | null };
  } catch (error) {
    console.error("[case-chat] IA não respondeu", { message: error instanceof Error ? error.message : String(error) });
    return {
      turn: null,
      aiError: "Sua mensagem e os anexos foram salvos, mas a IA não conseguiu responder agora. Toque em \"Tentar novamente\" para gerar a resposta.",
    };
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await loadOwnedCase(request, context.params.caseId);
    const [messages, pendingQuestions] = await Promise.all([
      fetchCaseChatMessages(context.params.caseId, token),
      fetchCasePendingQuestions(context.params.caseId, token).catch(() => []),
    ]);
    return NextResponse.json(
      {
        messages,
        awaitingAssistant: trailingUserMessages(messages as ChatMessageRow[]).length > 0,
        pendingQuestions,
        currentQuestion: getCurrentPendingQuestion(pendingQuestions),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Envia texto, fotos (várias) e/ou um áudio em uma única mensagem.
 * - Tudo é validado antes de qualquer upload; o plano é verificado antes.
 * - Arquivos e mensagens são gravados ANTES de chamar a IA: se a IA falhar,
 *   nada se perde e a resposta pode ser refeita com `{ "retry": true }`.
 * - Falha de transcrição não descarta o áudio.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const caseId = context.params.caseId;
  const uploadedPaths: string[] = [];

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BODY_BYTES) {
      throw new FriendlyRequestError("Os anexos ficaram grandes demais para envio. Remova uma foto ou grave um áudio mais curto.", 413, "PAYLOAD_TOO_LARGE");
    }

    const { token, user } = await loadOwnedCase(request, caseId);
    const contentType = request.headers.get("content-type") || "";
    let text = "";
    let images: File[] = [];
    let audio: File | null = null;
    let clientMessageId: string | null = null;
    let retry = false;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData().catch(() => {
        throw new FriendlyRequestError("Não foi possível ler os anexos. Tente novamente.", 400, "INVALID_BODY");
      });
      text = String(formData.get("message") || "").trim().slice(0, 4000);
      images = formData.getAll("images").filter(isFile);
      const audioEntry = formData.get("audio");
      audio = isFile(audioEntry) ? audioEntry : null;
      // Compatibilidade: campo único "file" + messageType.
      const legacyFile = formData.get("file");
      if (isFile(legacyFile)) {
        if (formData.get("messageType") === "audio") audio = legacyFile;
        else images.push(legacyFile);
      }
      const rawId = formData.get("clientMessageId");
      clientMessageId = isValidClientUploadId(rawId) ? rawId : null;
    } else {
      const payload = (await request.json().catch(() => null)) as { message?: string; retry?: boolean } | null;
      text = payload?.message?.trim().slice(0, 4000) || "";
      retry = payload?.retry === true;
    }

    if (retry) {
      const messages = (await fetchCaseChatMessages(caseId, token)) as ChatMessageRow[];
      const pending = trailingUserMessages(messages);
      if (!pending.length) {
        return NextResponse.json({ messages, aiError: null, retried: false });
      }
      await assertPlanLimit(user.id, "ai_question");
      const { turn, aiError } = await runAssistantTurnSafely(caseId, user.id, token, buildUserTurnContext(pending));
      const refreshed = await fetchCaseChatMessages(caseId, token).catch(() => messages);
      return NextResponse.json({ messages: refreshed, aiError, analysis: turn?.analysis ?? null, retried: true });
    }

    if (!text && !images.length && !audio) {
      throw new FriendlyRequestError("Escreva uma mensagem, anexe uma foto ou grave um áudio.", 400, "EMPTY_MESSAGE");
    }

    // 1) Validação completa antes de qualquer gravação.
    if (images.length > CASE_ATTACHMENT_LIMITS.maxChatImages) {
      throw new FriendlyRequestError(`Envie até ${CASE_ATTACHMENT_LIMITS.maxChatImages} fotos por mensagem.`, 400, "TOO_MANY_FILES");
    }
    for (const image of images) {
      if (!(await isAllowedUploadFile(image, PHOTO_MIME_TYPES, PHOTO_EXTENSIONS))) {
        throw new FriendlyRequestError(`A foto "${image.name}" não está em um formato aceito (JPG, PNG, WEBP ou HEIC).`, 400, "UNSUPPORTED_TYPE");
      }
      if (image.size > CASE_ATTACHMENT_LIMITS.maxPhotoBytes) {
        throw new FriendlyRequestError(`A foto "${image.name}" é grande demais. Escolha uma imagem menor.`, 400, "FILE_TOO_LARGE");
      }
    }
    if (audio) {
      if (!isAllowedAudio(audio)) {
        throw new FriendlyRequestError("Formato de áudio não aceito. Use WEBM, OGG, M4A, MP3 ou WAV.", 400, "UNSUPPORTED_TYPE");
      }
      if (audio.size > CASE_ATTACHMENT_LIMITS.maxAudioBytes) {
        throw new FriendlyRequestError("O áudio é longo demais. Grave uma mensagem de até 3 minutos.", 400, "FILE_TOO_LARGE");
      }
    }

    // 2) Limite do plano antes de gravar: se não houver saldo, nada é enviado e
    //    a mensagem continua no campo do usuário.
    await assertPlanLimit(user.id, "ai_question");

    // 3) Uploads (caminhos determinísticos por mensagem → repetição não duplica).
    const messageKey = clientMessageId ?? crypto.randomUUID();
    const imageUrls: string[] = [];
    for (const [index, image] of images.entries()) {
      const path = buildCaseAttachmentPath({ userId: user.id, caseId, kind: "chat_image", clientUploadId: `${messageKey}-${index}`, fileName: image.name });
      const { url, alreadyExisted } = await uploadCaseObject(image, path, token);
      if (!alreadyExisted) uploadedPaths.push(path);
      imageUrls.push(url);
    }
    let audioUrl: string | null = null;
    if (audio) {
      const contentType = resolveAudioContentType(audio);
      if (audio.type !== contentType) {
        audio = new File([await audio.arrayBuffer()], audio.name || "mensagem-de-voz.webm", { type: contentType });
      }
      const path = buildCaseAttachmentPath({ userId: user.id, caseId, kind: "chat_audio", clientUploadId: messageKey, fileName: audio.name || "mensagem-de-voz.webm" });
      const { url, alreadyExisted } = await uploadCaseObject(audio, path, token);
      if (!alreadyExisted) uploadedPaths.push(path);
      audioUrl = url;
    }

    // 4) Registro das mensagens (ordem preservada). Se o mesmo envio já foi
    //    gravado (nova tentativa após queda de rede), não duplica.
    const existingMessages = (await fetchCaseChatMessages(caseId, token).catch(() => [])) as AgronomicCaseChatMessage[];
    const alreadyRecorded = (url: string) => existingMessages.some((message) => message.file_url === url);
    const transcription = audio ? await transcribeAudio(audio) : null;

    // Reenvio da mesma mensagem ainda sem resposta (ex.: queda de rede) não duplica.
    const unansweredTexts = trailingUserMessages(existingMessages as ChatMessageRow[])
      .filter((message) => message.message_type === "text")
      .map((message) => message.message);
    if (text && !unansweredTexts.includes(text)) {
      await insertCaseChatMessage({ caseId, userId: user.id, role: "user", message: text }, token);
    }
    for (const url of imageUrls) {
      if (alreadyRecorded(url)) continue;
      await insertCaseChatMessage({ caseId, userId: user.id, role: "user", message: IMAGE_MESSAGE_LABEL, messageType: "image", fileUrl: url }, token);
      await attachImageToCase(caseId, user.id, url, "chat_image", token).catch((error) => {
        console.warn("[case-chat] foto do chat não vinculada aos anexos do caso", { message: error instanceof Error ? error.message : String(error) });
      });
    }
    if (audioUrl && !alreadyRecorded(audioUrl)) {
      await insertCaseChatMessage({ caseId, userId: user.id, role: "user", message: AUDIO_MESSAGE_LABEL, messageType: "audio", fileUrl: audioUrl }, token);
      if (transcription?.status === "success" && transcription.text) {
        await insertCaseChatMessage({ caseId, userId: user.id, role: "user", message: transcription.text, messageType: "transcription" }, token);
      }
    }
    // A partir daqui os arquivos estão referenciados no banco.
    uploadedPaths.length = 0;

    // 5) Resposta da IA (falha não apaga o que foi salvo).
    const afterInsert = (await fetchCaseChatMessages(caseId, token)) as ChatMessageRow[];
    const pending = trailingUserMessages(afterInsert);
    const { turn, aiError } = await runAssistantTurnSafely(caseId, user.id, token, buildUserTurnContext(pending));
    const messages = turn ? await fetchCaseChatMessages(caseId, token).catch(() => afterInsert) : afterInsert;

    return NextResponse.json({
      messages,
      aiError,
      analysis: turn?.analysis ?? null,
      currentQuestion: turn?.currentQuestion ?? null,
      transcription: transcription ? { status: transcription.status } : null,
    });
  } catch (error) {
    // Arquivos enviados sem registro no banco não ficam órfãos.
    if (uploadedPaths.length) {
      const token = getToken(request);
      if (token) await deleteCaseObjects(uploadedPaths, token);
    }
    return errorResponse(error);
  }
}

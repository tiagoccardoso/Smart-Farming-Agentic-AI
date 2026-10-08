import { NextRequest, NextResponse } from "next/server";
import {
  fetchAgronomicCase,
  getAuthenticatedUser,
  getCurrentPendingQuestion,
  supabaseRequest,
  type CasePendingQuestion,
} from "../../../../../lib/agronomic/case";
import {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  CASE_ATTACHMENT_LIMITS,
  CASE_STORAGE_BUCKET,
  MAX_REQUEST_BODY_BYTES,
  PHOTO_EXTENSIONS,
  PHOTO_MIME_TYPES,
  buildCaseAttachmentPath,
  isValidClientUploadId,
} from "../../../../../lib/agronomic/case-attachments";
import {
  AUDIO_MESSAGE_LABEL,
  IMAGE_MESSAGE_LABEL,
  trailingUserMessages,
  type ChatMessageRow,
} from "../../../../../lib/agronomic/case-chat";
import { CaseChatAIError, defaultChatLogger, loadChatImages } from "../../../../../lib/agronomic/case-chat-ai";
import { getCaseChatProviders } from "../../../../../lib/agronomic/case-chat-providers";
import { CaseChatAccessError, assertCaseChatAccess, recordUserTurn, runAssistantTurn, type CaseChatStore } from "../../../../../lib/server/case-chat-service";
import { createSupabaseCaseChatStore } from "../../../../../lib/server/case-chat-store";
import { getSupabaseConfig } from "../../../../../lib/server/supabase-rest";
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
export const dynamic = "force-dynamic";

/** Tempo útil da função antes do limite da Vercel (folga para gravar e responder). */
const TURN_BUDGET_MS = 54_000;

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
    const response = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/transcriptions`, {
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

function createStore(token: string) {
  return createSupabaseCaseChatStore({ token, fetchCase: fetchAgronomicCase });
}

async function loadOwnedCase(request: NextRequest, caseId: string) {
  const token = getToken(request);
  if (!token) throw new FriendlyRequestError("Faça login para usar o chat do caso.", 401, "AUTH_REQUIRED");
  const user = await getAuthenticatedUser(token).catch(() => {
    throw new FriendlyRequestError("Sua sessão expirou. Faça login novamente.", 401, "AUTH_REQUIRED");
  });
  const store = createStore(token);
  // Cada conversa pertence a um único caso e ao dono do caso (checagem no
  // servidor; a RLS do banco é a segunda barreira).
  const caseData = assertCaseChatAccess(await store.loadCase(caseId), user.id);
  return { token, user, caseData, store };
}

function requestIdFrom(request: NextRequest) {
  return request.headers.get("x-vercel-id")?.split("::").pop()?.slice(0, 40) || crypto.randomUUID().slice(0, 12);
}

const AI_FAILURE_MESSAGE = "Não foi possível obter a resposta da IA neste momento. Sua pergunta foi preservada. Tente novamente.";
const AI_NOT_CONFIGURED_MESSAGE = "A IA está indisponível no momento. Sua pergunta foi preservada; tente novamente mais tarde.";

async function pendingState(store: CaseChatStore, caseId: string) {
  const pendingQuestions = (await store.listPendingQuestions(caseId).catch(() => [])) as CasePendingQuestion[];
  return { pendingQuestions, currentQuestion: getCurrentPendingQuestion(pendingQuestions) };
}

/**
 * Gera a resposta da IA para o turno pendente. Falha da IA nunca vira resposta
 * falsa: devolve `aiError` e a pergunta continua salva para "Tentar novamente".
 */
async function respondToPendingTurn(input: { store: CaseChatStore; caseId: string; userId: string; requestId: string; startedAt: number }) {
  const supabaseUrl = getSupabaseConfig().supabaseUrl;
  try {
    const result = await runAssistantTurn(input.store, {
      caseId: input.caseId,
      userId: input.userId,
      requestId: input.requestId,
      providers: getCaseChatProviders(),
      deadlineAt: input.startedAt + TURN_BUDGET_MS,
      loadImages: (candidates) => loadChatImages(candidates, { allowedPrefix: `${supabaseUrl}/storage/v1/object/public/${CASE_STORAGE_BUCKET}/` }),
    });
    if (result.status === "answered") {
      await recordUsageEvent(input.userId, "ai_question").catch(() => null);
    }
    defaultChatLogger("turn_completed", { requestId: input.requestId, caseId: input.caseId, status: "success", result: result.status, persisted: result.status === "answered" });
    return { aiError: null as string | null, aiErrorCode: null as string | null, assistantMessage: result.message };
  } catch (error) {
    if (error instanceof CaseChatAccessError) throw error;
    const category = error instanceof CaseChatAIError ? error.category : "unexpected";
    defaultChatLogger("turn_failed", {
      requestId: input.requestId,
      caseId: input.caseId,
      status: "error",
      errorCategory: category,
      persisted: false,
      ...(error instanceof CaseChatAIError ? {} : { message: (error instanceof Error ? error.message : String(error)).slice(0, 200) }),
    });
    return { aiError: category === "not_configured" ? AI_NOT_CONFIGURED_MESSAGE : AI_FAILURE_MESSAGE, aiErrorCode: `AI_${String(category).toUpperCase()}`, assistantMessage: null };
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PlanLimitExceededError) {
    return NextResponse.json({ error: error.message || PLAN_LIMIT_REACHED_MESSAGE, code: "PLAN_LIMIT_REACHED", cta: error.result?.cta ?? null }, { status: 402 });
  }
  if (error instanceof UserInactiveError) {
    return NextResponse.json({ error: error.message, code: "USER_INACTIVE" }, { status: 403 });
  }
  if (error instanceof FriendlyRequestError || error instanceof CaseEditError || error instanceof CaseChatAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[case-chat] falha inesperada", { message: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "Não foi possível processar a mensagem agora. Tente novamente.", code: "UNEXPECTED" }, { status: 500 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { store } = await loadOwnedCase(request, context.params.caseId);
    const [messages, pending] = await Promise.all([store.listMessages(context.params.caseId), pendingState(store, context.params.caseId)]);
    return NextResponse.json(
      {
        messages,
        awaitingAssistant: trailingUserMessages(messages as ChatMessageRow[]).length > 0,
        ...pending,
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
  const startedAt = Date.now();
  const requestId = requestIdFrom(request);

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BODY_BYTES) {
      throw new FriendlyRequestError("Os anexos ficaram grandes demais para envio. Remova uma foto ou grave um áudio mais curto.", 413, "PAYLOAD_TOO_LARGE");
    }

    const { token, user, store } = await loadOwnedCase(request, caseId);
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
      const payload = (await request.json().catch(() => null)) as { message?: string; retry?: boolean; clientMessageId?: string } | null;
      text = payload?.message?.trim().slice(0, 4000) || "";
      retry = payload?.retry === true;
      clientMessageId = isValidClientUploadId(payload?.clientMessageId) ? payload!.clientMessageId! : null;
    }

    if (retry) {
      const messages = (await store.listMessages(caseId)) as ChatMessageRow[];
      if (!trailingUserMessages(messages).length) {
        return NextResponse.json({ messages, aiError: null, retried: false, requestId, ...(await pendingState(store, caseId)) });
      }
      await assertPlanLimit(user.id, "ai_question");
      const { aiError, aiErrorCode, assistantMessage } = await respondToPendingTurn({ store, caseId, userId: user.id, requestId, startedAt });
      const refreshed = await store.listMessages(caseId).catch(() => messages);
      return NextResponse.json({ messages: refreshed, aiError, aiErrorCode, assistantMessage, retried: true, requestId, ...(await pendingState(store, caseId)) });
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

    // 4) Registro das mensagens ANTES da IA (ordem preservada). Reenvio com o
    //    mesmo clientMessageId não duplica pergunta nem anexos.
    const transcription = audio ? await transcribeAudio(audio) : null;
    const recorded = await recordUserTurn(store, {
      caseId,
      userId: user.id,
      text,
      clientMessageId,
      imageUrls,
      audio: audioUrl ? { url: audioUrl, transcription: transcription?.status === "success" ? transcription.text : null } : null,
      imageLabel: IMAGE_MESSAGE_LABEL,
      audioLabel: AUDIO_MESSAGE_LABEL,
    });
    for (const url of imageUrls) {
      await attachImageToCase(caseId, user.id, url, "chat_image", token).catch((error) => {
        console.warn("[case-chat] foto do chat não vinculada aos anexos do caso", { message: error instanceof Error ? error.message : String(error) });
      });
    }
    // A partir daqui os arquivos estão referenciados no banco.
    uploadedPaths.length = 0;
    defaultChatLogger("user_turn_persisted", { requestId, caseId, status: "success", inserted: recorded.inserted.length, duplicateText: recorded.duplicateText, images: imageUrls.length, audio: Boolean(audioUrl) });

    // 5) Resposta da IA (falha não apaga o que foi salvo).
    const { aiError, aiErrorCode, assistantMessage } = await respondToPendingTurn({ store, caseId, userId: user.id, requestId, startedAt });
    const messages = await store.listMessages(caseId);

    return NextResponse.json({
      messages,
      aiError,
      aiErrorCode,
      assistantMessage,
      userMessageSaved: true,
      requestId,
      transcription: transcription ? { status: transcription.status } : null,
      ...(await pendingState(store, caseId)),
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

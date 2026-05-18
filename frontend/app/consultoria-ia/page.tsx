"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import SectionTitle from "../../components/SectionTitle";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import WorkflowStepper from "../../components/agronomic/WorkflowStepper";
import LoadingCard from "../../components/agronomic/LoadingCard";
import { RiskBadge, StatusBadge } from "../../components/agronomic/StatusBadge";
import { analyzeAgronomicCase, getAgronomicCase } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";
import type {
  AgronomicCase,
  AgronomicPreAnalysis,
} from "../../lib/agronomic/case";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "image" | "audio" | "transcription";
  fileUrl?: string | null;
  created_at?: string | null;
};

type PendingQuestion = {
  id: string;
  question: string;
  answer: string | null;
  status: "pending" | "answered" | "skipped";
  order_index: number;
};

const riskLabels: Record<string, string> = {
  low: "risco baixo",
  medium: "risco médio",
  high: "risco alto",
};

const statusLabels: Record<string, string> = {
  submitted: "Caso enviado",
  ai_analyzed: "Pré-análise gerada",
  waiting_human_review: "Aguardando revisão humana",
  human_reviewed: "Revisão humana concluída",
  completed: "Concluído",
};

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") {
    return "Não informado";
  }

  return String(value);
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-4 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900">
        {displayValue(value)}
      </p>
    </div>
  );
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-leaf-50 p-5">
      <h4 className="font-semibold text-slate-900">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600"
              aria-hidden
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsultoriaIAContent() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") ?? "";
  const [caseData, setCaseData] = useState<AgronomicCase | null>(null);
  const [analysis, setAnalysis] = useState<AgronomicPreAnalysis | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingCase, setLoadingCase] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState("IA analisando...");
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reviewUrl = useMemo(
    () => `/revisao-humana?caseId=${encodeURIComponent(caseId)}`,
    [caseId],
  );
  const requiresHumanReview =
    analysis?.riskLevel === "medium" || analysis?.riskLevel === "high";
  const currentPendingQuestion = pendingQuestions
    .filter((item) => item.status === "pending")
    .sort((a, b) => a.order_index - b.order_index)[0];
  const answeredQuestionsCount = pendingQuestions.filter(
    (item) => item.status === "answered",
  ).length;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
  }, [question]);

  useEffect(() => {
    async function loadCase() {
      setError(null);
      setCaseData(null);
      setAnalysis(null);
      setChatMessages([]);
      setPendingQuestions([]);

      if (!caseId) {
        return;
      }

      const accessToken = getStoredSupabaseAccessToken();

      if (!accessToken) {
        setError("Faça login para carregar os dados do caso enviado.");
        return;
      }

      setLoadingCase(true);

      try {
        const response = (await getAgronomicCase(caseId, accessToken)) as {
          case: AgronomicCase;
        };
        setCaseData(response.case);
        const savedMessages = (response.case.chat_messages ?? []).map(
          (message) => ({
            id: message.id,
            role: message.role,
            content: message.message,
            messageType: message.message_type ?? "text",
            fileUrl: message.file_url,
            created_at: message.created_at,
          }),
        );

        setChatMessages(
          savedMessages.length
            ? savedMessages
            : (response.case.question_history ?? []).flatMap((historyItem) => [
                { role: "user" as const, content: historyItem.question },
                {
                  role: "assistant" as const,
                  content:
                    historyItem.answer ??
                    "Resposta registrada no histórico, mas sem conteúdo salvo para exibição.",
                },
              ]),
        );
        setPendingQuestions(response.case.pending_questions ?? []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar o caso.",
        );
      } finally {
        setLoadingCase(false);
      }
    }

    loadCase();
  }, [caseId]);

  async function handleGenerateAnalysis() {
    if (!caseId) {
      setError("Abra a consultoria usando um caseId válido na URL.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setError("Faça login para gerar a pré-análise com IA.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = (await analyzeAgronomicCase(caseId, accessToken)) as {
        analysis: AgronomicPreAnalysis;
        pendingQuestions?: PendingQuestion[];
        currentQuestion?: PendingQuestion | null;
      };
      setAnalysis(response.analysis);
      setPendingQuestions(response.pendingQuestions ?? []);
      const introMessages: ChatMessage[] = [
        {
          role: "assistant",
          content:
            "Pré-análise gerada. Vou conduzir a consulta em etapas e fazer apenas uma pergunta pendente por vez.",
        },
      ];

      if (response.currentQuestion) {
        introMessages.push({
          role: "assistant",
          content: response.currentQuestion.question,
        });
      }

      setChatMessages(introMessages);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Não foi possível gerar a pré-análise.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function sendChatPayload(
    formData: FormData | null,
    optimisticMessage: ChatMessage,
    status: string,
  ) {
    if (!caseId) {
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();

    if (!accessToken) {
      setError("Faça login para conversar com a IA sobre este caso.");
      return;
    }

    setChatStatus(status);
    setChatLoading(true);
    setError(null);
    setChatMessages((current) => [...current, optimisticMessage]);

    try {
      const response = await fetch(
        `/api/agronomic-cases/${encodeURIComponent(caseId)}/chat`,
        {
          method: "POST",
          headers: formData
            ? { Authorization: `Bearer ${accessToken}` }
            : {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
          body:
            formData ?? JSON.stringify({ message: optimisticMessage.content }),
        },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error || "Não foi possível enviar a mensagem.",
        );
      }

      if (payload.analysis) {
        setAnalysis(payload.analysis);
      }
      if (Array.isArray(payload.pendingQuestions)) {
        setPendingQuestions(payload.pendingQuestions);
      } else if (payload.currentQuestion) {
        setPendingQuestions((current) =>
          current.map((item) =>
            item.id === payload.currentQuestion.id
              ? payload.currentQuestion
              : item,
          ),
        );
      }
      if (!Array.isArray(payload.pendingQuestions) && payload.answeredQuestion) {
        setPendingQuestions((current) =>
          current.map((item) =>
            item.id === payload.answeredQuestion.id
              ? payload.answeredQuestion
              : item,
          ),
        );
      }
      if (payload.assistantMessage) {
        setChatMessages((current) => [
          ...current,
          {
            id: payload.assistantMessage.id,
            role: "assistant",
            content: payload.assistantMessage.message,
            messageType: payload.assistantMessage.message_type ?? "text",
            fileUrl: payload.assistantMessage.file_url,
            created_at: payload.assistantMessage.created_at,
          },
        ]);
      }
    } catch (chatError) {
      setError(
        chatError instanceof Error
          ? chatError.message
          : "Não foi possível enviar a mensagem.",
      );
    } finally {
      setChatLoading(false);
    }
  }

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion || !caseId) {
      return;
    }

    setQuestion("");
    await sendChatPayload(
      null,
      { role: "user", content: trimmedQuestion, messageType: "text" },
      currentPendingQuestion
        ? "IA gerando próxima pergunta..."
        : "IA analisando...",
    );
  }

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
      setError("Envie imagens jpg, jpeg, png ou webp.");
      return;
    }

    const formData = new FormData();
    formData.append("messageType", "image");
    formData.append("message", question.trim());
    formData.append("file", file);
    setQuestion("");

    await sendChatPayload(
      formData,
      {
        role: "user",
        content: question.trim() || "Nova imagem enviada durante a conversa.",
        messageType: "image",
        fileUrl: URL.createObjectURL(file),
      },
      "IA processando imagem...",
    );
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, {
          type: "audio/webm",
        });
        setAudioBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
    } catch {
      setError("Não foi possível acessar o microfone neste navegador.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
  }

  function cancelRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
    }
    setRecording(false);
    setAudioBlob(null);
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    setAudioPreviewUrl(null);
    setRecordingSeconds(0);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
  }

  async function sendRecordedAudio() {
    if (!audioBlob) {
      return;
    }

    const file = new File([audioBlob], `resposta-${Date.now()}.webm`, {
      type: "audio/webm",
    });
    const formData = new FormData();
    formData.append("messageType", "audio");
    formData.append("file", file);

    await sendChatPayload(
      formData,
      {
        role: "user",
        content:
          "Áudio enviado. A IA está transcrevendo e analisando a resposta.",
        messageType: "audio",
        fileUrl: audioPreviewUrl,
      },
      "IA transcrevendo áudio...",
    );
    cancelRecording();
  }

  return (
    <div className="bg-hero-gradient">
      <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
        <WorkflowStepper
          steps={[
            {
              title: "Enviar caso",
              description: "Dados e anexos registrados.",
              href: "/enviar-caso",
              status: caseData ? "done" : "next",
            },
            {
              title: "Gerar pré-análise",
              description: "IA organiza hipóteses e risco.",
              status: analysis ? "done" : "current",
            },
            {
              title: "Revisão humana",
              description: "Recomendada para risco médio ou alto.",
              href: caseId ? reviewUrl : undefined,
              status: requiresHumanReview ? "current" : "next",
            },
            {
              title: "Meus relatórios",
              description: "Acesse o parecer final quando disponível.",
              href: "/meus-relatorios",
              status: "next",
            },
          ]}
        />

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-soft md:p-8">
            <p className="mb-4 inline-flex rounded-full bg-leaf-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
              Consultoria agronômica com IA
            </p>
            <SectionTitle
              title="Consultoria IA"
              subtitle="Veja o caso enviado, gere uma pré-análise e converse com a IA."
            />
            <p className="text-sm leading-6 text-slate-600">
              A IA organiza os dados do caso para uma triagem inicial. Ela
              sempre deve ser usada como apoio preliminar, não como substituta
              de diagnóstico ou revisão profissional.
            </p>
            <SafetyDisclaimer className="mt-5" />

            {!caseId && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Nenhum caseId foi informado na URL. Envie um caso completo para
                iniciar a consultoria com dados do Supabase.
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerateAnalysis}
                disabled={!caseData || generating || loadingCase}
                className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {generating
                  ? "Gerando pré-análise..."
                  : "Gerar pré-análise com IA"}
              </button>
              <Link
                href="/enviar-caso"
                className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft hover:border-leaf-300"
              >
                Enviar outro caso
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-xl font-semibold text-slate-900">
                Resumo do caso
              </h3>
              {caseData && (
                <StatusBadge
                  status={caseData.status}
                  label={
                    statusLabels[caseData.status ?? ""] ??
                    caseData.status ??
                    "Sem status"
                  }
                />
              )}
            </div>
            {loadingCase ? (
              <div className="mt-4">
                <LoadingCard
                  title="Carregando caso"
                  description="Buscando dados, sintomas e anexos salvos no Supabase..."
                  rows={4}
                />
              </div>
            ) : caseData ? (
              <div className="mt-6 space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoItem label="Cultura" value={caseData.crop} />
                  <InfoItem label="Propriedade" value={caseData.farm?.name} />
                  <InfoItem
                    label="Cidade/Estado"
                    value={[caseData.farm?.city, caseData.farm?.state]
                      .filter(Boolean)
                      .join("/")}
                  />
                  <InfoItem
                    label="Estágio da cultura"
                    value={caseData.growth_stage}
                  />
                </div>

                <div className="rounded-2xl bg-leaf-50 p-5">
                  <h4 className="font-semibold text-slate-900">Sintomas</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {caseData.symptoms}
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">Histórico</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {displayValue(caseData.history)}
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-900">
                    Imagens anexadas
                  </h4>
                  {caseData.images.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {caseData.images.map((image) => (
                        <a
                          key={image.id}
                          href={image.image_url}
                          target="_blank"
                          rel="noreferrer"
                          className="overflow-hidden rounded-2xl border border-leaf-100 bg-slate-50 shadow-soft"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.image_url}
                            alt="Imagem anexada ao caso"
                            className="h-44 w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      Nenhuma imagem anexada.
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">
                    Análise de solo
                  </h4>
                  {caseData.soil_analysis_url ? (
                    <a
                      href={caseData.soil_analysis_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-sm font-semibold text-leaf-700 hover:text-leaf-800"
                    >
                      Abrir análise de solo anexada
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      Nenhuma análise de solo anexada.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                Informe um caseId válido para visualizar o resumo do caso.
              </p>
            )}
          </div>
        </div>

        {!analysis && !generating && (
          <div className="mt-10 rounded-3xl border border-dashed border-leaf-200 bg-white p-8 text-center shadow-soft">
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf-50 text-2xl"
              aria-hidden
            >
              🤖
            </div>
            <h3 className="mt-5 text-xl font-semibold text-slate-900">
              A pré-análise ainda não foi gerada
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Confira o resumo do caso e clique em “Gerar pré-análise com IA”.
              Se o risco vier médio ou alto, a tela indicará a revisão humana
              paga.
            </p>
          </div>
        )}

        {generating && (
          <div className="mt-10">
            <LoadingCard
              title="Gerando pré-análise com IA"
              description="A IA está avaliando sintomas, histórico e anexos para produzir uma triagem inicial."
              rows={5}
            />
          </div>
        )}

        {analysis && (
          <>
            <div className="mt-10 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">
                    Resultado da IA
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">
                    Pré-análise agronômica inicial
                  </h3>
                </div>
                <RiskBadge riskLevel={analysis.riskLevel} />
              </div>
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">
                    Diagnóstico inicial
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {analysis.initialDiagnosis}
                  </p>
                </div>
                <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">
                    Recomendação inicial
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {analysis.initialRecommendation}
                  </p>
                </div>
                <AnalysisList
                  title="Hipóteses prováveis"
                  items={analysis.probableHypotheses}
                />
                <AnalysisList
                  title="Fila de perguntas pendentes"
                  items={
                    currentPendingQuestion
                      ? [
                          `Pergunta atual: ${currentPendingQuestion.question}`,
                          `${answeredQuestionsCount} de ${pendingQuestions.length} perguntas já respondidas. As demais serão liberadas uma por vez no chat.`,
                        ]
                      : [
                          "Triagem inicial concluída.",
                          `Nível de risco/confiança operacional: ${riskLabels[analysis.riskLevel] ?? analysis.riskLevel}.`,
                          "Não há perguntas pendentes obrigatórias na fila oficial do banco.",
                        ]
                  }
                />
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">
                    Aviso de orientação não substitutiva
                  </p>
                  <p className="mt-2">{analysis.disclaimer}</p>
                  <p className="mt-2">{analysis.whenToCallHumanSpecialist}</p>
                </div>
                {requiresHumanReview ? (
                  <Link
                    href={reviewUrl}
                    className="inline-flex justify-center rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
                  >
                    Pagar revisão humana
                  </Link>
                ) : (
                  <Link
                    href="/meus-relatorios"
                    className="inline-flex justify-center rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft hover:border-leaf-300"
                  >
                    Ver em Meus Relatórios
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-10 rounded-[2rem] border border-leaf-100 bg-white p-4 shadow-soft md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold text-slate-900">
                    Converse com a IA sobre esse caso
                  </h3>
                  <p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">
                    Responda às perguntas pendentes e continue a conversa com
                    base no histórico, sintomas, imagens, solo e contexto da
                    cultura selecionada.
                  </p>
                </div>
                <span className="rounded-full bg-leaf-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-leaf-700">
                  Histórico vinculado ao caseId
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-leaf-100 bg-leaf-50/70 px-4 py-3 text-sm text-leaf-900">
                <span className="font-semibold">Fluxo progressivo:</span>
                <span>
                  {currentPendingQuestion
                    ? `Pergunta atual ${answeredQuestionsCount + 1}/${pendingQuestions.length}: ${currentPendingQuestion.question}`
                    : "Triagem inicial concluída. Não há pergunta pending real na fila oficial."}
                </span>
              </div>

              <div className="mt-5 min-h-[620px] max-h-[78vh] space-y-6 overflow-y-auto rounded-[1.75rem] border border-slate-100 bg-slate-50/70 p-4 md:p-6">
                {chatMessages.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-leaf-200 bg-white p-6 text-base leading-7 text-slate-600">
                    Gere a pré-análise para iniciar uma conversa
                    contextualizada. A IA liberará apenas uma pergunta pendente
                    por vez.
                  </div>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      key={message.id ?? `${message.role}-${index}`}
                      className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {message.role === "assistant" && (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-leaf-600 text-sm font-bold text-white shadow-soft">
                          IA
                        </div>
                      )}
                      <div
                        className={`max-w-[88%] rounded-[1.5rem] px-5 py-4 text-base leading-7 shadow-sm md:max-w-[76%] ${message.role === "user" ? "rounded-br-sm bg-slate-900 text-white" : "rounded-bl-sm border border-leaf-100 bg-white text-slate-700"}`}
                      >
                        {message.fileUrl && message.messageType === "image" && (
                          <a
                            href={message.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={message.fileUrl}
                              alt="Imagem enviada no chat"
                              className="mb-3 max-h-72 w-full rounded-2xl object-cover"
                            />
                          </a>
                        )}
                        {message.fileUrl && message.messageType === "audio" && (
                          <audio
                            controls
                            src={message.fileUrl}
                            className="mb-3 w-full min-w-56"
                          >
                            <track kind="captions" />
                          </audio>
                        )}
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        {message.messageType === "audio" && (
                          <p className="mt-2 text-xs opacity-80">
                            Transcrição do áudio
                          </p>
                        )}
                      </div>
                      {message.role === "user" && (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow-soft">
                          Você
                        </div>
                      )}
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex items-center gap-3 text-sm font-semibold text-leaf-700">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-leaf-600 text-white">
                      IA
                    </div>
                    <div className="flex items-center gap-3 rounded-full bg-white px-4 py-3 shadow-sm">
                      <span className="h-2.5 w-2.5 animate-ping rounded-full bg-leaf-500" />
                      {chatStatus}
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={handleAskQuestion}
                className="mt-5 grid gap-3 rounded-[1.75rem] border border-leaf-100 bg-leaf-50/50 p-3 md:grid-cols-[auto_auto_1fr_auto] md:items-end"
              >
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={!analysis || chatLoading}
                  className="rounded-full border border-leaf-200 bg-white px-5 py-4 text-sm font-bold text-leaf-700 shadow-soft hover:border-leaf-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  📷 Foto
                </button>
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!analysis || chatLoading}
                  className={`rounded-full px-5 py-4 text-sm font-bold shadow-soft disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${recording ? "bg-red-600 text-white" : "border border-leaf-200 bg-white text-leaf-700"}`}
                >
                  {recording ? `Parar ${recordingSeconds}s` : "🎙️ Áudio"}
                </button>
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Responda com detalhes. Enter cria nova linha; Ctrl/⌘+Enter envia."
                  disabled={!analysis || chatLoading}
                  rows={3}
                  className="min-h-32 resize-none rounded-[1.25rem] border border-leaf-100 bg-white px-5 py-4 text-base leading-7 text-slate-900 shadow-soft outline-none transition focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100 disabled:bg-slate-100"
                />
                <button
                  type="submit"
                  disabled={!analysis || chatLoading || !question.trim()}
                  className="rounded-full bg-leaf-600 px-8 py-4 text-sm font-bold uppercase tracking-wide text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {chatLoading ? "Enviando..." : "Enviar"}
                </button>
              </form>

              {(recording || audioPreviewUrl) && (
                <div className="mt-3 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {recording ? (
                    <div className="flex flex-wrap items-center gap-3 font-semibold">
                      <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
                      Gravando áudio: {recordingSeconds}s
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : audioPreviewUrl ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <audio controls src={audioPreviewUrl}>
                        <track kind="captions" />
                      </audio>
                      <button
                        type="button"
                        onClick={sendRecordedAudio}
                        disabled={chatLoading}
                        className="rounded-full bg-leaf-600 px-5 py-2 font-bold text-white disabled:bg-slate-300"
                      >
                        Enviar áudio
                      </button>
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="font-semibold underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function ConsultoriaIAPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-14 text-sm text-slate-600">
          Carregando consultoria...
        </div>
      }
    >
      <ConsultoriaIAContent />
    </Suspense>
  );
}

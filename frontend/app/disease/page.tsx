"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SectionTitle from "../../components/SectionTitle";
import MobileImagePicker from "../../components/MobileImagePicker";
import SafetyDisclaimer from "../../components/agronomic/SafetyDisclaimer";
import { detectDisease } from "../../lib/api";
import { getStoredSupabaseAccessToken } from "../../lib/supabaseAuth";

type CropOption = {
  id: string;
  name: string;
  display_name_pt?: string | null;
  common_diseases?: string | null;
  common_pests?: string | null;
  ideal_climate?: string | null;
  recommended_soil?: string | null;
  growth_cycle?: string | null;
};

type DiseaseAnalysis = {
  initialDiagnosis: string;
  probableDiseases: Array<{ name: string; evidence?: string }>;
  confidenceLevel: "low" | "medium" | "high" | string;
  riskLevel: "low" | "medium" | "high" | string;
  possibleCauses: string[];
  missingQuestions: string[];
  initialRecommendations: string[];
  productionImpact: string;
  whenToCallHumanSpecialist: string;
  disclaimer: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "image" | "audio" | "transcription";
  fileUrl?: string | null;
};

type PendingQuestion = {
  id: string;
  question: string;
  answer: string | null;
  status: "pending" | "answered" | "skipped";
  order_index: number;
};

const riskLabels: Record<string, string> = {
  low: "Risco baixo",
  medium: "Risco médio",
  high: "Risco alto",
};

const confidenceLabels: Record<string, string> = {
  low: "Confiança baixa",
  medium: "Confiança média",
  high: "Confiança alta",
};

const riskStyles: Record<string, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-700",
};

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${riskStyles[value] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}>
      {label}
    </span>
  );
}

function CardList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
      <h4 className="font-semibold text-slate-900">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DiseasePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [crop, setCrop] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [growthStage, setGrowthStage] = useState("");
  const [soilType, setSoilType] = useState("");
  const [history, setHistory] = useState("");
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatText, setChatText] = useState("");
  const [analysis, setAnalysis] = useState<DiseaseAnalysis | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const selectedCrop = useMemo(
    () => crops.find((item) => [item.name, item.display_name_pt].includes(crop)),
    [crop, crops],
  );
  const currentPendingQuestion = pendingQuestions
    .filter((question) => question.status === "pending")
    .sort((a, b) => a.order_index - b.order_index)[0];
  const needsHumanReview =
    analysis?.riskLevel === "medium" ||
    analysis?.riskLevel === "high" ||
    analysis?.confidenceLevel === "low";

  useEffect(() => {
    fetch("/api/crops")
      .then((response) => response.json())
      .then((payload) => setCrops(Array.isArray(payload?.crops) ? payload.crops : []))
      .catch(() => setCrops([]));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  function selectFile(nextFile: File | null) {
    if (nextFile && !nextFile.type.match(/^image\/(jpeg|png|webp)$/)) {
      setError("Envie imagens JPG, PNG ou WEBP.");
      return;
    }

    setError(null);
    setFile(nextFile);
    setZoomOpen(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleSubmit() {
    if (!file || !crop.trim() || !symptoms.trim() || !state.trim()) {
      setError("Envie foto, cultura, sintomas e localização para iniciar a consulta.");
      return;
    }

    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) {
      setError("Faça login para criar um caso agronômico e conversar com a IA.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await detectDisease({
        file,
        crop,
        symptoms,
        state,
        city,
        growthStage,
        soilType,
        history,
      });
      const data = response.data;
      setAnalysis(data.analysis);
      setCaseId(data.caseId);
      setImageUrl(data.imageUrl);
      setPendingQuestions(data.pendingQuestions ?? []);
      setChatMessages([
        {
          role: "assistant",
          content: data.currentQuestion
            ? `Triagem visual concluída. Converse com a IA sobre este caso.\n\n${data.currentQuestion.question}`
            : "Triagem visual concluída. Converse com a IA sobre este caso e envie novas fotos ou áudio se o problema evoluir.",
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível analisar a imagem.");
    } finally {
      setLoading(false);
    }
  }

  async function sendChatPayload(formData: FormData | null, optimisticMessage: ChatMessage) {
    if (!caseId) {
      return;
    }
    const accessToken = getStoredSupabaseAccessToken();
    if (!accessToken) {
      setError("Faça login para continuar a conversa.");
      return;
    }

    setChatLoading(true);
    setError(null);
    setChatMessages((current) => [...current, optimisticMessage]);

    try {
      const response = await fetch(`/api/agronomic-cases/${encodeURIComponent(caseId)}/chat`, {
        method: "POST",
        headers: formData
          ? { Authorization: `Bearer ${accessToken}` }
          : { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: formData ?? JSON.stringify({ message: optimisticMessage.content }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível enviar a mensagem.");
      }

      if (payload.analysis) {
        setAnalysis((current) =>
          current
            ? {
                ...current,
                initialDiagnosis: payload.analysis.initialDiagnosis,
                riskLevel: payload.analysis.riskLevel,
                missingQuestions: payload.analysis.missingQuestions ?? current.missingQuestions,
                whenToCallHumanSpecialist: payload.analysis.whenToCallHumanSpecialist,
              }
            : current,
        );
      }
      if (Array.isArray(payload.pendingQuestions)) {
        setPendingQuestions(payload.pendingQuestions);
      } else if (payload.answeredQuestion) {
        setPendingQuestions((current) =>
          current.map((item) => (item.id === payload.answeredQuestion.id ? payload.answeredQuestion : item)),
        );
      }
      if (!Array.isArray(payload.pendingQuestions) && payload.currentQuestion) {
        setPendingQuestions((current) =>
          current.map((item) => (item.id === payload.currentQuestion.id ? payload.currentQuestion : item)),
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
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
    } finally {
      setChatLoading(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatText.trim();
    if (!message) {
      return;
    }
    setChatText("");
    await sendChatPayload(null, { role: "user", content: message, messageType: "text" });
  }

  async function handleChatImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) {
      return;
    }
    if (!selected.type.match(/^image\/(jpeg|png|webp)$/)) {
      setError("Envie imagens JPG, PNG ou WEBP.");
      return;
    }
    const formData = new FormData();
    formData.append("messageType", "image");
    formData.append("message", chatText.trim());
    formData.append("file", selected);
    const localUrl = URL.createObjectURL(selected);
    setChatText("");
    await sendChatPayload(formData, {
      role: "user",
      content: chatText.trim() || "Nova foto enviada para comparar a evolução dos sintomas.",
      messageType: "image",
      fileUrl: localUrl,
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    } catch {
      setError("Não foi possível acessar o microfone neste navegador.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function cancelRecording() {
    if (recording) mediaRecorderRef.current?.stop();
    setRecording(false);
    setAudioBlob(null);
    setAudioPreviewUrl(null);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function sendRecordedAudio() {
    if (!audioBlob) return;
    const formData = new FormData();
    formData.append("messageType", "audio");
    formData.append("file", new File([audioBlob], `audio-${Date.now()}.webm`, { type: "audio/webm" }));
    await sendChatPayload(formData, {
      role: "user",
      content: "Áudio enviado para transcrição e refinamento da análise.",
      messageType: "audio",
      fileUrl: audioPreviewUrl,
    });
    cancelRecording();
  }

  return (
    <div className="bg-hero-gradient">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-14 lg:py-20">
        <div className="grid gap-10 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-leaf-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-leaf-700">
              Consulta agrícola inteligente
            </p>
            <SectionTitle
              title="Triagem multimodal de doenças agrícolas"
              subtitle="Envie foto, cultura, sintomas e localização para abrir um caso agronômico com IA contextualizada."
            />
            <SafetyDisclaimer className="mt-5" />
            <div className="mt-6 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/85 p-4 shadow-soft">Imagem + sintomas + cultura</div>
              <div className="rounded-2xl bg-white/85 p-4 shadow-soft">Base crops + specialist_knowledge</div>
              <div className="rounded-2xl bg-white/85 p-4 shadow-soft">Chat com foto e áudio</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/95 p-6 shadow-soft md:p-8">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`rounded-[2rem] border-2 border-dashed p-5 text-center transition ${dragging ? "border-leaf-500 bg-leaf-50" : "border-leaf-200 bg-slate-50"}`}
            >
              {previewUrl ? (
                <button type="button" onClick={() => setZoomOpen(true)} className="block w-full overflow-hidden rounded-[1.5rem] bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Prévia da planta enviada" className="max-h-96 w-full object-contain" />
                </button>
              ) : (
                <div className="py-12">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-leaf-100 text-3xl">📷</div>
                  <p className="mt-4 font-semibold text-slate-900">Arraste a foto da planta aqui</p>
                  <p className="mt-1 text-sm text-slate-500">JPG, PNG ou WEBP até 10MB</p>
                </div>
              )}
              <MobileImagePicker
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                cameraAccept="image/*"
                galleryLabel="Escolher imagem"
                cameraLabel="Tirar foto"
                galleryAriaLabel="Escolher imagem da planta"
                cameraAriaLabel="Tirar foto da planta"
                onGalleryChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                onCameraChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                className="mt-4 justify-center"
              />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Cultura
                <input
                  value={crop}
                  onChange={(event) => setCrop(event.target.value)}
                  list="crop-options"
                  placeholder="Soja, tomate, milho..."
                  className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400"
                />
                <datalist id="crop-options">
                  {crops.map((item) => (
                    <option key={item.id} value={item.display_name_pt || item.name} />
                  ))}
                </datalist>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Estágio da cultura
                <input value={growthStage} onChange={(event) => setGrowthStage(event.target.value)} placeholder="Vegetativo, florescimento..." className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Cidade
                <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Município" className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Estado
                <input value={state} onChange={(event) => setState(event.target.value)} placeholder="UF ou estado" className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Sintomas observados
              <textarea value={symptoms} onChange={(event) => setSymptoms(event.target.value)} rows={4} placeholder="Manchas, coloração, necrose, deformações, pragas visíveis, início dos sintomas..." className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Solo
                <input value={soilType} onChange={(event) => setSoilType(event.target.value)} placeholder="Argiloso, arenoso, drenagem..." className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Histórico recente
                <input value={history} onChange={(event) => setHistory(event.target.value)} placeholder="Chuva, irrigação, pulverização..." className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 outline-none focus:border-leaf-400" />
              </label>
            </div>

            {selectedCrop && (
              <div className="mt-5 rounded-2xl bg-leaf-50 p-4 text-xs leading-5 text-slate-700">
                <p className="font-bold text-leaf-800">Contexto automático da cultura</p>
                <p>Doenças comuns: {selectedCrop.common_diseases || "não cadastradas"}</p>
                <p>Pragas: {selectedCrop.common_pests || "não cadastradas"}</p>
                <p>Clima/solo: {[selectedCrop.ideal_climate, selectedCrop.recommended_soil].filter(Boolean).join(" • ") || "não cadastrado"}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="mt-6 w-full rounded-full bg-leaf-600 px-6 py-4 text-sm font-bold uppercase tracking-wide text-white shadow-soft hover:bg-leaf-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? "Analisando imagem, cultura e contexto..." : "Iniciar triagem inteligente"}
            </button>
            {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          </div>
        </div>

        {loading && (
          <div className="mt-10 rounded-3xl border border-leaf-100 bg-white p-8 shadow-soft">
            <div className="flex items-center gap-4 text-leaf-700">
              <span className="h-4 w-4 animate-ping rounded-full bg-leaf-500" />
              <div>
                <p className="font-bold">IA multimodal em análise</p>
                <p className="text-sm text-slate-600">Cruzando imagem, cultura, sintomas, clima/solo cadastrado, histórico e conhecimento especialista.</p>
              </div>
            </div>
          </div>
        )}

        {analysis && (
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-start">
            <div className="space-y-6">
              <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">Diagnóstico inicial</p>
                    <h3 className="mt-2 text-2xl font-semibold text-slate-900">Análise agrícola contextualizada</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge label={riskLabels[analysis.riskLevel] ?? analysis.riskLevel} value={analysis.riskLevel} />
                    <Badge label={confidenceLabels[analysis.confidenceLevel] ?? analysis.confidenceLevel} value={analysis.confidenceLevel} />
                  </div>
                </div>
                <p className="mt-5 text-sm leading-7 text-slate-700">{analysis.initialDiagnosis}</p>
                {imageUrl && (
                  <a href={imageUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-bold text-leaf-700 hover:text-leaf-800">
                    Abrir imagem salva no caso
                  </a>
                )}
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl bg-white p-5 shadow-soft">
                  <h4 className="font-semibold text-slate-900">Hipóteses prováveis</h4>
                  <div className="mt-3 space-y-3">
                    {analysis.probableDiseases.map((item) => (
                      <div key={item.name} className="rounded-2xl border border-leaf-100 bg-leaf-50 p-4">
                        <p className="font-semibold text-leaf-800">{item.name}</p>
                        {item.evidence && <p className="mt-1 text-xs leading-5 text-slate-600">{item.evidence}</p>}
                      </div>
                    ))}
                  </div>
                </div>
                <CardList title="Possíveis causas" items={analysis.possibleCauses} />
                <CardList title="Recomendações iniciais" items={analysis.initialRecommendations} />
                <CardList title="Perguntas pendentes" items={currentPendingQuestion ? [`Pergunta atual: ${currentPendingQuestion.question}`, "As próximas perguntas serão feitas uma por vez no chat."] : ["Triagem inicial concluída.", `Nível de confiança: ${confidenceLabels[analysis.confidenceLevel] ?? analysis.confidenceLevel}.`, "Não há perguntas pendentes obrigatórias na fila oficial do banco."]} />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
                  <h4 className="font-bold">Impacto possível na produção</h4>
                  <p className="mt-2">{analysis.productionImpact}</p>
                </div>
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-800">
                  <h4 className="font-bold">Quando procurar revisão humana</h4>
                  <p className="mt-2">{analysis.whenToCallHumanSpecialist}</p>
                </div>
              </div>

              {needsHumanReview && (
                <div className="rounded-3xl border border-red-200 bg-white p-6 shadow-soft">
                  <h3 className="text-xl font-semibold text-slate-900">Solicitar revisão da Doutora em Agronomia</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Recomendado para risco médio/alto, baixa confiança, conflito de hipóteses, sintomas graves ou possível perda econômica.</p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link href={caseId ? `/revisao-humana?caseId=${encodeURIComponent(caseId)}` : "/revisao-humana"} className="rounded-full bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-soft">Revisão humana</Link>
                    <Link href={caseId ? `/consultoria-ia?caseId=${encodeURIComponent(caseId)}` : "/consultoria-ia"} className="rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-bold text-leaf-700 shadow-soft">Gerar relatório técnico</Link>
                    <Link href="/planos" className="rounded-full border border-leaf-200 bg-white px-5 py-3 text-sm font-bold text-leaf-700 shadow-soft">Contratar acompanhamento</Link>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-leaf-700">Converse com a IA sobre este caso</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">Atendimento progressivo</h3>
                </div>
                {caseId && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Caso salvo</span>}
              </div>
              <div className="mt-5 max-h-[34rem] space-y-4 overflow-y-auto rounded-[1.5rem] bg-slate-50 p-4">
                {chatMessages.map((message, index) => (
                  <div key={message.id ?? index} className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-6 shadow-sm ${message.role === "assistant" ? "bg-white text-slate-700" : "bg-leaf-600 text-white"}`}>
                      {message.fileUrl && message.messageType === "image" && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={message.fileUrl} alt="Imagem enviada no chat" className="mb-3 max-h-48 rounded-xl object-contain" />
                      )}
                      {message.fileUrl && message.messageType === "audio" && (
                        <audio controls src={message.fileUrl} className="mb-3 w-full"><track kind="captions" /></audio>
                      )}
                      <p className="whitespace-pre-line">{message.content}</p>
                    </div>
                  </div>
                ))}
                {chatLoading && <div className="text-sm font-semibold text-leaf-700">IA refinando parecer...</div>}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} className="mt-4 space-y-3">
                <textarea value={chatText} onChange={(event) => setChatText(event.target.value)} rows={4} placeholder="Responda à pergunta atual, descreva evolução ou acrescente detalhes do talhão." className="w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-400" />
                <div className="flex flex-wrap gap-2">
                  <MobileImagePicker
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    cameraAccept="image/*"
                    galleryLabel="Enviar nova foto"
                    cameraLabel="Tirar foto"
                    galleryAriaLabel="Selecionar nova foto para o chat"
                    cameraAriaLabel="Tirar nova foto para o chat"
                    disabled={chatLoading}
                    onGalleryChange={handleChatImage}
                    onCameraChange={handleChatImage}
                  />
                  <button type="button" onClick={recording ? stopRecording : startRecording} disabled={chatLoading} className={`rounded-full px-4 py-3 text-sm font-bold disabled:bg-slate-100 ${recording ? "bg-red-600 text-white" : "border border-leaf-200 bg-white text-leaf-700"}`}>{recording ? `Parar ${recordingSeconds}s` : "Gravar áudio"}</button>
                  <button type="submit" disabled={chatLoading || !chatText.trim()} className="ml-auto rounded-full bg-leaf-600 px-6 py-3 text-sm font-bold text-white disabled:bg-slate-300">Enviar</button>
                </div>
              </form>

              {(recording || audioPreviewUrl) && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {recording ? (
                    <div className="flex items-center gap-3"><span className="h-3 w-3 animate-pulse rounded-full bg-red-600" /> Gravando: {recordingSeconds}s <button type="button" onClick={cancelRecording} className="underline">Cancelar</button></div>
                  ) : audioPreviewUrl ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <audio controls src={audioPreviewUrl}><track kind="captions" /></audio>
                      <button type="button" onClick={sendRecordedAudio} className="rounded-full bg-leaf-600 px-4 py-2 font-bold text-white">Enviar áudio</button>
                      <button type="button" onClick={cancelRecording} className="font-semibold underline">Cancelar</button>
                    </div>
                  ) : null}
                </div>
              )}
              <p className="mt-4 text-xs leading-5 text-slate-500">{analysis.disclaimer} A IA não emite laudo definitivo, não receita defensivos controlados e não substitui agrônomo responsável.</p>
            </div>
          </div>
        )}
      </section>

      {zoomOpen && previewUrl && (
        <button type="button" onClick={() => setZoomOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Zoom da imagem da planta" className="max-h-full max-w-full rounded-2xl object-contain" />
        </button>
      )}
    </div>
  );
}

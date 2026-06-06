"use client";

import { useEffect, useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import ChatBubble from "../../components/ChatBubble";
import { askQuestion, getQuestionHistory } from "../../lib/api";

type QuestionHistoryItem = {
  id: string;
  question: string;
  answer: string | null;
  created_at: string | null;
};

export default function QAPage() {
  const [question, setQuestion] = useState("Com que frequência devo irrigar tomateiros?");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [history, setHistory] = useState<QuestionHistoryItem[]>([]);


  useEffect(() => {
    async function loadHistory() {
      try {
        const response = (await getQuestionHistory()) as { history?: QuestionHistoryItem[] };
        setHistory(response.history ?? []);
      } catch {
        setHistory([]);
      }
    }

    loadHistory();
  }, []);

  const handleAsk = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setChat((prev) => [...prev, { role: "user", text: question }]);

    try {
      const response = await askQuestion(question);
      setChat((prev) => [...prev, { role: "assistant", text: response.answer }]);
      setHistory((prev) => [
        {
          id: `${Date.now()}`,
          question,
          answer: response.answer,
          created_at: new Date().toISOString()
        },
        ...prev
      ].slice(0, 25));
      setSources(response.retrieved_docs || []);
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível responder à pergunta.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-14">
      <SectionTitle title="Perguntas agrícolas" subtitle="Faça perguntas práticas e receba orientação com uma base local em português." />

      <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <div className="space-y-4">
          {chat.length === 0 && (
            <div className="text-sm text-slate-500">As respostas aparecerão aqui.</div>
          )}
          {chat.map((message, idx) => (
            <ChatBubble key={idx} role={message.role} text={message.text} />
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="flex-1 rounded-full border border-leaf-100 bg-white px-5 py-3 text-sm shadow-soft focus:border-leaf-400 focus:outline-none"
            placeholder="Faça uma pergunta sobre agricultura..."
          />
          <button
            onClick={handleAsk}
            className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft"
            disabled={loading}
          >
            {loading ? "Pensando..." : "Perguntar"}
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <h4 className="text-sm font-semibold text-slate-900">Histórico de perguntas</h4>
        <p className="mt-2 text-xs leading-5 text-slate-500">As perguntas respondidas ficam salvas mesmo no plano gratuito, sempre respeitando o limite mensal de uso.</p>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          {history.length === 0 && <p>Nenhuma pergunta salva ainda.</p>}
          {history.map((item) => (
            <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-800">{item.question}</p>
              {item.answer && <p className="mt-2 line-clamp-3">{item.answer}</p>}
              {item.created_at && <p className="mt-2 text-xs text-slate-400">{new Date(item.created_at).toLocaleString("pt-BR")}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <h4 className="text-sm font-semibold text-slate-900">Conhecimento recuperado</h4>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          {sources.length === 0 && <p>Nenhuma fonte ainda. Faça uma pergunta para ver os trechos usados.</p>}
          {sources.map((doc, idx) => (
            <div key={idx} className="rounded-2xl bg-leaf-50 p-4">
              <p className="text-xs text-slate-500">Relevância: {(doc.relevance_score * 100).toFixed(1)}%</p>
              {doc.title && <p className="mt-1 font-semibold text-slate-800">{doc.title}</p>}
              <p className="mt-1">{doc.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

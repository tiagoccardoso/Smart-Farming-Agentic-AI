"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

// ─── Types ───────────────────────────────────────────────────────────────────

type CropOption = { id: string; display_name_pt: string | null; name: string };

type Disease = {
  id: string;
  common_name: string;
  scientific_name?: string | null;
  causal_agent?: string | null;
  disease_type?: string | null;
  symptoms?: string | null;
  favorable_conditions?: string | null;
  crop_stage?: string | null;
  severity_level?: string | null;
  management_recommendations?: string | null;
  preventive_control?: string | null;
  curative_control?: string | null;
  technical_notes?: string | null;
  crop_id?: string | null;
  is_active: boolean;
};

type AiDiseaseData = {
  nome_comum: string;
  nome_cientifico: string;
  agente_causal: string;
  tipo_agente: string;
  sintomas_principais: string;
  condicoes_favoraveis: string;
  periodo_critico_ocorrencia: string;
  nivel_severidade: string;
  manejo_preventivo: string;
  controle_biologico_preventivo: string;
  manejo_curativo_quimico: string;
  observacoes_tecnicas?: string;
};

type AiSearchResponse =
  | { success: true; summary: string; data: AiDiseaseData; debug?: { raw_text?: string; warnings?: string[] } }
  | { success: false; error: string; details?: string; debug?: { raw_text?: string; warnings?: string[] } };

type MappableField = keyof Omit<Disease, "id" | "crop_id" | "is_active">;

type Toast = { id: string; type: "success" | "error" | "warning"; message: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const EMPTY_FORM: Disease = {
  id: "",
  common_name: "",
  scientific_name: "",
  causal_agent: "",
  disease_type: "",
  symptoms: "",
  favorable_conditions: "",
  crop_stage: "",
  severity_level: "",
  management_recommendations: "",
  preventive_control: "",
  curative_control: "",
  technical_notes: "",
  crop_id: "",
  is_active: true,
};

const AI_FIELD_MAP: Array<[MappableField, keyof AiDiseaseData]> = [
  ["common_name", "nome_comum"],
  ["scientific_name", "nome_cientifico"],
  ["causal_agent", "agente_causal"],
  ["disease_type", "tipo_agente"],
  ["symptoms", "sintomas_principais"],
  ["favorable_conditions", "condicoes_favoraveis"],
  ["crop_stage", "periodo_critico_ocorrencia"],
  ["severity_level", "nivel_severidade"],
  ["management_recommendations", "manejo_preventivo"],
  ["preventive_control", "controle_biologico_preventivo"],
  ["curative_control", "manejo_curativo_quimico"],
  ["technical_notes", "observacoes_tecnicas"],
];

const REQUIRED_FIELDS: Array<keyof Disease> = [
  "common_name",
  "scientific_name",
  "causal_agent",
  "disease_type",
  "symptoms",
  "favorable_conditions",
  "crop_stage",
  "severity_level",
  "management_recommendations",
  "preventive_control",
  "curative_control",
];

type FieldConfig = {
  key: MappableField;
  label: string;
  required: boolean;
  rows: number;
  span?: "full";
  placeholder: string;
};

const FIELD_CONFIGS: FieldConfig[] = [
  { key: "common_name", label: "Nome comum", required: true, rows: 1, placeholder: "Ex: Antracnose, Ferrugem, Oídio..." },
  { key: "scientific_name", label: "Nome científico", required: true, rows: 1, placeholder: "Ex: Colletotrichum spp." },
  { key: "causal_agent", label: "Agente causal", required: true, rows: 2, placeholder: "Organismo patogênico responsável..." },
  { key: "disease_type", label: "Tipo de agente", required: true, rows: 1, placeholder: "Fungo, Bactéria, Vírus, Nematoide..." },
  { key: "symptoms", label: "Sintomas principais", required: true, rows: 4, span: "full", placeholder: "Descreva os sintomas visíveis no campo..." },
  { key: "favorable_conditions", label: "Condições favoráveis", required: true, rows: 3, span: "full", placeholder: "Clima, umidade, temperatura e ambiente que favorecem a doença..." },
  { key: "crop_stage", label: "Período crítico de ocorrência", required: true, rows: 2, span: "full", placeholder: "Fase da cultura ou época de maior risco..." },
  { key: "severity_level", label: "Nível de severidade", required: true, rows: 1, placeholder: "Baixa, Média ou Alta (com justificativa)..." },
  { key: "management_recommendations", label: "Manejo preventivo", required: true, rows: 3, span: "full", placeholder: "Medidas culturais, sanitárias e preventivas..." },
  { key: "preventive_control", label: "Controle biológico / preventivo", required: true, rows: 3, span: "full", placeholder: "Opções biológicas e preventivas disponíveis..." },
  { key: "curative_control", label: "Manejo curativo / químico", required: true, rows: 4, span: "full", placeholder: "Opções de controle químico — sempre com ressalva de receituário agronômico..." },
  { key: "technical_notes", label: "Observações técnicas", required: false, rows: 3, span: "full", placeholder: "Notas adicionais, variações regionais, referências técnicas..." },
];

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldSkeleton({ span }: { span?: "full" }) {
  return (
    <div className={`animate-pulse space-y-2 ${span === "full" ? "sm:col-span-2" : ""}`}>
      <div className="h-3 w-32 rounded bg-slate-200" />
      <div className="h-20 w-full rounded-xl bg-slate-200" />
    </div>
  );
}

function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      Preenchido pela IA
    </span>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl px-5 py-4 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : toast.type === "error"
              ? "bg-red-600 text-white"
              : "bg-amber-500 text-white"
          }`}
        >
          <span className="flex-1 leading-relaxed">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="ml-1 opacity-70 transition-opacity hover:opacity-100"
            aria-label="Fechar notificação"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function SeverityBadge({ level }: { level: string }) {
  const l = level.toLowerCase();
  if (l.includes("alt") || l.includes("sever") || l.includes("high") || l.includes("grave"))
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">{level}</span>;
  if (l.includes("médi") || l.includes("medi") || l.includes("moder"))
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{level}</span>;
  return <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">{level}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [items, setItems] = useState<Disease[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [form, setForm] = useState<Disease>(EMPTY_FORM);
  const [listSearch, setListSearch] = useState("");

  // AI state
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());

  // UI state
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const token = () => getStoredSupabaseAccessToken();

  // Toast helpers
  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = newId();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    const t = token();
    if (!t) return;
    setLoadingData(true);
    try {
      const [d, c] = await Promise.all([
        fetch("/api/specialist/diseases", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/specialist/crops", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      const dp = await d.json();
      const cp = await c.json();
      if (d.ok) setItems(dp.diseases ?? []);
      if (c.ok) setCrops(cp.crops ?? []);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Apply AI data to form
  const applyAiData = useCallback((data: AiDiseaseData) => {
    const filled = new Set<string>();
    setForm((cur) => {
      const next = { ...cur };
      for (const [field, key] of AI_FIELD_MAP) {
        if (editedFields.has(field)) continue;
        const value = String(data[key] ?? "").trim();
        if (value) {
          (next as Record<string, unknown>)[field] = value;
          filled.add(field);
        }
      }
      return next;
    });
    setAiFilledFields(filled);
  }, [editedFields]);

  // Run AI query
  async function runAi(e?: FormEvent) {
    e?.preventDefault();
    const t = token();
    if (!t || aiLoading) return;
    const query = aiQuery.trim();
    if (!query) return;

    setAiLoading(true);
    setAiError(null);
    setAiSummary(null);
    setAiWarnings([]);
    setAiFilledFields(new Set());

    try {
      const r = await fetch("/api/specialist/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ type: "disease", name: query, history: [] }),
      });
      const p = (await r.json()) as AiSearchResponse;

      if (!r.ok || !p.success) {
        const msg = "error" in p && p.error ? p.error : "Falha ao consultar a IA. Tente novamente.";
        setAiError(msg);
        return;
      }

      setAiSummary(p.summary);
      setAiWarnings(p.debug?.warnings ?? []);
      applyAiData(p.data);

      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch {
      setAiError("Falha de rede ao consultar a IA. Verifique sua conexão e tente novamente.");
    } finally {
      setAiLoading(false);
    }
  }

  // Handle field change
  function handleFieldChange(field: keyof Disease, value: string) {
    setEditedFields((prev) => new Set([...prev, String(field)]));
    setAiFilledFields((prev) => {
      const next = new Set(prev);
      next.delete(String(field));
      return next;
    });
    setForm((c) => ({ ...c, [field]: value }));
  }

  // Derived
  const filledCount = useMemo(
    () => REQUIRED_FIELDS.filter((f) => String(form[f] ?? "").trim().length > 0).length,
    [form],
  );
  const isFormValid = filledCount === REQUIRED_FIELDS.length;
  const progressPct = Math.round((filledCount / REQUIRED_FIELDS.length) * 100);

  // Submit
  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token();
    if (!t || saving || !isFormValid) return;
    setSaving(true);
    try {
      const payload = { ...form, crop_id: form.crop_id?.trim() ? form.crop_id : null };
      const r = await fetch("/api/specialist/diseases", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(payload),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p?.error || "Falha ao salvar");
      addToast("success", form.id ? "Doença atualizada com sucesso." : "Doença cadastrada com sucesso.");
      setForm(EMPTY_FORM);
      setAiFilledFields(new Set());
      setEditedFields(new Set());
      setAiQuery("");
      setAiSummary(null);
      setAiWarnings([]);
      await loadData();
      searchInputRef.current?.focus();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  // Delete
  async function deleteDisease(id: string, name: string) {
    if (!confirm(`Deseja excluir "${name}" do catálogo?`)) return;
    const t = token();
    if (!t) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/specialist/diseases?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p?.error || "Falha ao excluir");
      addToast("success", `"${name}" removido do catálogo.`);
      if (form.id === id) { setForm(EMPTY_FORM); setAiFilledFields(new Set()); setEditedFields(new Set()); }
      await loadData();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  // Edit
  function editDisease(d: Disease) {
    setForm({ ...EMPTY_FORM, ...d, crop_id: d.crop_id ?? "" });
    setEditedFields(new Set());
    setAiFilledFields(new Set());
    setAiSummary(null);
    setAiError(null);
    setAiWarnings([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const visibleItems = useMemo(
    () => items.filter((x) => `${x.common_name} ${x.scientific_name ?? ""}`.toLowerCase().includes(listSearch.toLowerCase())),
    [items, listSearch],
  );

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Back link */}
      <Link
        href="/configuracoes"
        className="inline-flex items-center gap-1.5 text-sm text-leaf-700 transition-colors hover:text-leaf-900 hover:underline"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Configurações
      </Link>

      <div className="mt-4">
        <SectionTitle
          title="Cadastro de Doenças"
          subtitle="Pesquise o nome de uma doença e a IA preenche automaticamente os campos técnicos. Revise, ajuste e salve."
        />
      </div>

      {/* ── AI Search Bar ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <form onSubmit={(e) => void runAi(e)}>
          <div
            className={`relative flex items-center gap-3 rounded-2xl border-2 bg-white p-2 pl-5 shadow-soft transition-all duration-300 ${
              aiLoading
                ? "border-leaf-400 ring-4 ring-leaf-100"
                : "border-leaf-200 focus-within:border-leaf-500 focus-within:ring-4 focus-within:ring-leaf-100"
            }`}
          >
            {/* Search / spinner icon */}
            <div className="flex-shrink-0 text-leaf-600">
              {aiLoading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
            </div>

            <input
              ref={searchInputRef}
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="Digite o nome da doença (ex: Antracnose, Ferrugem Asiática, Oídio...)"
              className="flex-1 bg-transparent text-base text-slate-800 placeholder-slate-400 outline-none"
              disabled={aiLoading}
              aria-label="Pesquisar doença para preenchimento automático pela IA"
            />

            <button
              type="submit"
              disabled={aiLoading || !aiQuery.trim()}
              className="flex-shrink-0 rounded-xl bg-leaf-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-leaf-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiLoading ? "Consultando..." : "Consultar IA"}
            </button>
          </div>

          {/* Indeterminate loading bar */}
          {aiLoading && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-leaf-100">
              <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-leaf-400 to-leaf-600" />
            </div>
          )}
        </form>

        {/* AI loading status text */}
        {aiLoading && (
          <p className="mt-3 flex items-center gap-2 text-sm text-leaf-700">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            A IA está buscando informações agronômicas técnicas...
          </p>
        )}

        {/* AI Error */}
        {aiError && !aiLoading && (
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">{aiError}</p>
              <button
                type="button"
                onClick={() => void runAi()}
                className="mt-2 text-xs font-semibold text-red-700 underline hover:text-red-900"
              >
                Tentar novamente
              </button>
            </div>
            <button onClick={() => setAiError(null)} className="text-red-400 hover:text-red-600">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        {/* AI Summary */}
        {aiSummary && !aiLoading && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600">
                <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Resumo da IA</p>
                  {aiFilledFields.size > 0 && (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      {aiFilledFields.size} campos preenchidos
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-emerald-900">{aiSummary}</p>
                {aiFilledFields.size > 0 && (
                  <p className="mt-1.5 text-xs text-emerald-700">
                    Os campos marcados com <strong>Preenchido pela IA</strong> foram populados automaticamente — revise antes de salvar.
                  </p>
                )}
              </div>
            </div>
            {aiWarnings.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-semibold text-amber-800">Avisos</p>
                <ul className="space-y-0.5">
                  {aiWarnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-700">• {w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Form ──────────────────────────────────────────────────────── */}
      <div ref={formRef}>
        <form onSubmit={submit} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
          {/* Form header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-6 py-4">
            <div>
              <h3 className="font-semibold text-slate-900">
                {form.id ? "Editar doença cadastrada" : "Nova doença"}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {filledCount} de {REQUIRED_FIELDS.length} campos obrigatórios preenchidos
                {aiFilledFields.size > 0 && ` · ${aiFilledFields.size} pela IA`}
              </p>
            </div>
            {form.id && (
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setAiFilledFields(new Set());
                  setEditedFields(new Set());
                  setAiSummary(null);
                  setAiError(null);
                }}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
              >
                Cancelar edição
              </button>
            )}
          </div>

          <div className="p-6">
            {/* Progress bar */}
            <div className="mb-6">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-slate-500">Progresso do cadastro</span>
                <span className={`text-xs font-semibold ${isFormValid ? "text-leaf-700" : "text-slate-500"}`}>
                  {progressPct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-leaf-500 to-leaf-600 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Fields grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELD_CONFIGS.map(({ key, label, required, rows, span, placeholder }) => {
                const isAiFilled = aiFilledFields.has(key);
                const fieldValue = String(form[key] ?? "");
                const isMissing = required && !fieldValue.trim() && !aiLoading;

                if (aiLoading) {
                  return <FieldSkeleton key={key} span={span} />;
                }

                return (
                  <div key={key} className={span === "full" ? "sm:col-span-2" : ""}>
                    <div
                      className={`group relative rounded-xl border transition-all duration-200 ${
                        isAiFilled
                          ? "border-emerald-300 bg-emerald-50/20 ring-1 ring-emerald-200/60"
                          : isMissing
                          ? "border-slate-200 bg-white"
                          : "border-slate-200 bg-white"
                      } focus-within:border-leaf-400 focus-within:ring-2 focus-within:ring-leaf-100`}
                    >
                      {/* Left accent for AI-filled */}
                      {isAiFilled && (
                        <div className="absolute inset-y-0 left-0 w-0.5 rounded-l-xl bg-emerald-400" />
                      )}

                      <div className="flex items-center justify-between px-4 pb-1 pt-3">
                        <label
                          htmlFor={`field-${key}`}
                          className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 group-focus-within:text-leaf-700"
                        >
                          {label}
                          {required && <span className="ml-1 text-red-400">*</span>}
                        </label>
                        {isAiFilled && <AiBadge />}
                      </div>

                      <textarea
                        id={`field-${key}`}
                        rows={rows}
                        required={required}
                        value={fieldValue}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        disabled={aiLoading}
                        placeholder={placeholder}
                        className="w-full resize-y bg-transparent px-4 pb-3 pt-1 text-sm text-slate-800 placeholder-slate-300 outline-none"
                      />
                    </div>
                  </div>
                );
              })}

              {/* Crop select */}
              <div className="sm:col-span-2">
                {aiLoading ? (
                  <FieldSkeleton span="full" />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white transition-all duration-200 focus-within:border-leaf-400 focus-within:ring-2 focus-within:ring-leaf-100">
                    <div className="px-4 pb-1 pt-3">
                      <label htmlFor="field-crop" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Cultura vinculada
                      </label>
                    </div>
                    <select
                      id="field-crop"
                      value={form.crop_id ?? ""}
                      onChange={(e) => setForm((c) => ({ ...c, crop_id: e.target.value }))}
                      disabled={aiLoading}
                      className="w-full bg-transparent px-4 pb-3 pt-1 text-sm text-slate-800 outline-none"
                    >
                      <option value="">Não vinculada a uma cultura específica</option>
                      {crops.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.display_name_pt || c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <div className="sm:col-span-2">
                {aiLoading ? (
                  <div className="flex animate-pulse items-center gap-3">
                    <div className="h-6 w-11 rounded-full bg-slate-200" />
                    <div className="h-4 w-40 rounded bg-slate-200" />
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={form.is_active}
                        onChange={(e) => setForm((c) => ({ ...c, is_active: e.target.checked }))}
                      />
                      <div className={`h-6 w-11 rounded-full transition-colors duration-200 ${form.is_active ? "bg-leaf-600" : "bg-slate-300"}`} />
                      <div className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${form.is_active ? "translate-x-6" : "translate-x-1"}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {form.is_active ? "Doença ativa no catálogo" : "Doença inativa"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {form.is_active ? "Visível no sistema de diagnóstico" : "Oculta do sistema de diagnóstico"}
                      </p>
                    </div>
                  </label>
                )}
              </div>
            </div>

            {/* Submit area */}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={saving || !isFormValid || aiLoading}
                className="rounded-full bg-leaf-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-leaf-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[200px]"
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Salvando...
                  </span>
                ) : form.id ? (
                  "Salvar alterações"
                ) : (
                  "Salvar cadastro"
                )}
              </button>

              {!isFormValid && !aiLoading && (
                <p className="text-xs text-slate-400">
                  {REQUIRED_FIELDS.length - filledCount} campo{REQUIRED_FIELDS.length - filledCount !== 1 ? "s" : ""} obrigatório{REQUIRED_FIELDS.length - filledCount !== 1 ? "s" : ""} pendente{REQUIRED_FIELDS.length - filledCount !== 1 ? "s" : ""}
                </p>
              )}

              {isFormValid && !saving && (
                <p className="flex items-center gap-1.5 text-xs text-leaf-700">
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Pronto para salvar
                </p>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* ── Disease List ───────────────────────────────────────────────── */}
      <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center gap-4 border-b border-slate-100 bg-slate-50/60 px-6 py-4">
          <div>
            <h3 className="font-semibold text-slate-900">Doenças cadastradas</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {items.length} {items.length === 1 ? "registro" : "registros"}
            </p>
          </div>
          <div className="relative ml-auto">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar doença..."
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm outline-none transition-all focus:border-leaf-400 focus:ring-2 focus:ring-leaf-100"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {loadingData ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 p-5">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-44 rounded bg-slate-200" />
                  <div className="h-3 w-32 rounded bg-slate-100" />
                  <div className="h-3 w-24 rounded bg-slate-100" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-16 rounded-full bg-slate-200" />
                  <div className="h-7 w-16 rounded-full bg-slate-200" />
                </div>
              </div>
            ))
          ) : visibleItems.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="mx-auto mb-3 h-12 w-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-slate-400">
                {listSearch ? "Nenhuma doença encontrada para esta busca." : "Nenhuma doença cadastrada ainda."}
              </p>
            </div>
          ) : (
            visibleItems.map((d) => (
              <article
                key={d.id}
                className={`flex items-center gap-4 p-5 transition-colors hover:bg-slate-50 ${form.id === d.id ? "bg-leaf-50/40 ring-1 ring-inset ring-leaf-200" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm text-slate-900">{d.common_name}</strong>
                    {d.severity_level && <SeverityBadge level={d.severity_level} />}
                    {d.disease_type && (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {d.disease_type}
                      </span>
                    )}
                    {!d.is_active && (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                        Inativo
                      </span>
                    )}
                  </div>
                  {d.scientific_name && (
                    <p className="mt-0.5 truncate text-xs italic text-slate-400">{d.scientific_name}</p>
                  )}
                  {d.causal_agent && (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{d.causal_agent}</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => editDisease(d)}
                    className="rounded-full border border-leaf-200 bg-leaf-50 px-3 py-1.5 text-xs font-semibold text-leaf-700 transition-colors hover:bg-leaf-100"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === d.id}
                    onClick={() => void deleteDisease(d.id, d.common_name)}
                    className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
                  >
                    {deletingId === d.id ? (
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      "Excluir"
                    )}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

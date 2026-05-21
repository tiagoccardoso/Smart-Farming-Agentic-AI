"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import SectionTitle from "../../../components/SectionTitle";
import LoadingCard from "../../../components/agronomic/LoadingCard";
import ChatBubble from "../../../components/ChatBubble";
import { getStoredSupabaseAccessToken } from "../../../lib/supabaseAuth";

type CropRecord = {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  model_label: string | null;
  display_name_pt: string;
  display_name_en: string | null;
  scientific_name: string | null;
  recommended_soil: string | null;
  ideal_climate: string | null;
  common_diseases: string | null;
  common_pests: string | null;
  growth_cycle: string | null;
  irrigation_notes: string | null;
  fertilization_notes: string | null;
  recommended_region: string | null;
  known_risks: string | null;
  management_notes: string | null;
  active: boolean;
};

type CropForm = Omit<CropRecord, "id"> & { id?: string };

const emptyForm: CropForm = {
  name: "",
  slug: "",
  aliases: [],
  model_label: "",
  display_name_pt: "",
  display_name_en: "",
  scientific_name: "",
  recommended_soil: "",
  ideal_climate: "",
  common_diseases: "",
  common_pests: "",
  growth_cycle: "",
  irrigation_notes: "",
  fertilization_notes: "",
  recommended_region: "",
  known_risks: "",
  management_notes: "",
  active: true,
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.error || "A solicitação não pôde ser concluída.");
  return payload;
}

export default function CulturasPainelDoutoraPage() {
  const [crops, setCrops] = useState<CropRecord[]>([]);
  const [form, setForm] = useState<CropForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiName, setAiName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [cropSuggestion, setCropSuggestion] = useState<Partial<CropForm> | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadCrops() {
    const token = getStoredSupabaseAccessToken();
    if (!token) {
      setError("Faça login como specialist/admin para gerenciar culturas.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await parseResponse(
        await fetch("/api/specialist/crops", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      setCrops(payload.crops ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar culturas.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCrops();
  }, []);

  function updateForm(field: keyof CropForm, value: string | boolean | string[]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function editCrop(crop: CropRecord) {
    setForm({ ...crop, aliases: crop.aliases ?? [] });
    setSuccess(null);
    setError(null);
  }



  async function fillWithAI() {
    const token = getStoredSupabaseAccessToken();
    if (!token) return;
    if (!aiName.trim()) {
      setError("Informe o nome da cultura para preenchimento com IA.");
      return;
    }
    setAiLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = await parseResponse(await fetch("/api/specialist/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "crop", name: aiName.trim() }),
      }));
      const safeSuggestion = payload?.suggestion && typeof payload.suggestion === "object" ? payload.suggestion : null;
      if (!safeSuggestion) {
        setError("A IA respondeu sem dados estruturados válidos para o cadastro.");
        return;
      }
      setCropSuggestion(safeSuggestion);
      setChatMessages((current) => [
        ...current,
        { role: "user", text: aiName.trim() },
        { role: "assistant", text: payload?.message || "Sugestão gerada. Clique em aplicar no cadastro para preencher o formulário." },
      ]);
      setSuccess("Sugestão gerada. Clique em “Aplicar no cadastro”.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível gerar sugestão da IA.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion() {
    if (!cropSuggestion) return;
    setApplyingSuggestion(true);
    setForm((current) => ({ ...current, ...cropSuggestion, id: current.id }));
    setApplyingSuggestion(false);
    setSuccess("Dados da IA aplicados no cadastro. Revise antes de salvar.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getStoredSupabaseAccessToken();
    if (!token) return;
    if (!form.name.trim() || !form.display_name_pt?.trim()) {
      setError("Nome e nome em português da cultura são obrigatórios.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await parseResponse(
        await fetch("/api/specialist/crops", {
          method: form.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...form,
            aliases: Array.isArray(form.aliases) ? form.aliases : [],
          }),
        }),
      );
      setSuccess(
        form.id
          ? "Cultura atualizada com sucesso."
          : "Cultura cadastrada com sucesso.",
      );
      setForm(emptyForm);
      await loadCrops();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar cultura.",
      );
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<[keyof CropForm, string, boolean?]> = [
    ["name", "Nome administrativo", true],
    ["display_name_pt", "Nome em português", true],
    ["display_name_en", "Nome em inglês"],
    ["slug", "Slug"],
    ["model_label", "Label do modelo ML"],
    ["scientific_name", "Nome científico"],
    ["recommended_soil", "Solo recomendado"],
    ["ideal_climate", "Clima ideal"],
    ["growth_cycle", "Ciclo"],
    ["recommended_region", "Região recomendada"],
    ["common_diseases", "Doenças comuns"],
    ["common_pests", "Pragas comuns"],
    ["known_risks", "Riscos conhecidos"],
    ["irrigation_notes", "Irrigação"],
    ["fertilization_notes", "Adubação"],
    ["management_notes", "Manejo"],
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          href="/configuracoes"
          className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
        >
          ⚙️ Configurações
        </Link>
        <Link
          href="/painel-doutora/usuarios"
          className="rounded-full border border-leaf-200 px-4 py-2 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
        >
          Usuários
        </Link>
        <Link
          href="/painel-doutora/culturas"
          className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft"
        >
          Culturas
        </Link>
      </div>
      <SectionTitle
        title="Culturas"
        subtitle="Cadastre contexto agrícola que a IA usa automaticamente em análises e recomendações."
      />
      {error && (
        <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          {success}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft"
        >
          <h2 className="text-xl font-bold text-slate-900">
            {form.id ? "Editar cultura" : "Cadastrar cultura"}
          </h2>
          <div className="mt-4 rounded-2xl border border-leaf-100 bg-leaf-50 p-4">
            <p className="text-sm font-semibold text-leaf-800">Chat de preenchimento assistido por IA</p>
            <div className="mt-2 flex flex-col gap-2 md:flex-row">
              <input
                value={aiName}
                onChange={(event) => setAiName(event.target.value)}
                placeholder="Digite o nome da cultura"
                className="w-full rounded-2xl border border-leaf-100 bg-white px-4 py-3 text-sm"
              />
              <button type="button" onClick={fillWithAI} disabled={aiLoading} className="rounded-full bg-leaf-700 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300">{aiLoading ? "Consultando..." : "Enviar para IA"}</button>
            </div>
            <div className="mt-3 space-y-2">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-slate-600">Pesquise uma cultura e depois aplique os dados retornados pela IA no formulário.</p>
              ) : (
                chatMessages.map((message, index) => (
                  <ChatBubble key={`${message.role}-${index}`} role={message.role} text={message.text} />
                ))
              )}
            </div>
            <div className="mt-3">
              <button
                type="button"
                disabled={!cropSuggestion || applyingSuggestion}
                onClick={applySuggestion}
                className="rounded-full border border-leaf-300 bg-white px-5 py-2 text-sm font-semibold text-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applyingSuggestion ? "Aplicando..." : "Aplicar no cadastro"}
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {fields.map(([field, label, required]) => (
              <label
                key={field}
                className={field === "management_notes" ? "md:col-span-2" : ""}
              >
                <span className="text-sm font-semibold text-slate-700">
                  {label}
                  {required ? " *" : ""}
                </span>
                <textarea
                  required={required}
                  rows={field === "management_notes" ? 4 : 2}
                  value={String(form[field] ?? "")}
                  onChange={(event) => updateForm(field, event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
                />
              </label>
            ))}
            <label className="md:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Aliases (um por linha ou separados por vírgula)</span>
              <textarea
                rows={3}
                value={(form.aliases ?? []).join("\n")}
                onChange={(event) =>
                  updateForm(
                    "aliases",
                    event.target.value
                      .split(/[\n,;]/)
                      .map((alias) => alias.trim())
                      .filter(Boolean),
                  )
                }
                className="mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none focus:border-leaf-500 focus:ring-2 focus:ring-leaf-100"
              />
            </label>
          </div>
          <label className="mt-5 flex items-center gap-3 rounded-2xl bg-leaf-50 p-4 text-sm font-semibold text-leaf-800">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => updateForm("active", event.target.checked)}
            />{" "}
            Cultura ativa
          </label>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              disabled={saving}
              className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700 disabled:bg-slate-300"
            >
              {saving ? "Salvando..." : "Salvar cultura"}
            </button>
            <button
              type="button"
              onClick={() => setForm(emptyForm)}
              className="rounded-full border border-leaf-200 px-6 py-3 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
            >
              Cancelar edição
            </button>
          </div>
        </form>

        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h2 className="text-xl font-bold text-slate-900">
            Culturas cadastradas
          </h2>
          {loading ? (
            <div className="mt-5">
              <LoadingCard
                title="Carregando culturas"
                description="Consultando base agrícola."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {crops.map((crop) => (
                <button
                  key={crop.id}
                  onClick={() => editCrop(crop)}
                  className="w-full rounded-2xl border border-slate-100 p-4 text-left hover:border-leaf-200 hover:bg-leaf-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <strong>{crop.display_name_pt || crop.name}</strong>
                      <p className="mt-1 text-xs text-slate-500">
                        Label ML: {crop.model_label || "não suportada pelo modelo"} · Slug: {crop.slug}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${crop.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {crop.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 line-clamp-2">
                    Aliases: {(crop.aliases ?? []).join(", ") || "sem aliases"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                    {crop.ideal_climate || crop.management_notes || "Sem detalhes"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

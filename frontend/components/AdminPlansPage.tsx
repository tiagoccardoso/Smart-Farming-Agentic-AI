"use client";

/**
 * Area administrativa dos planos e servicos.
 *
 * Restrito a administradores (a API tambem valida o papel no servidor).
 * Aqui ficam nome, descricao, preco exibido, recursos, limites (entitlements) e
 * os identificadores reais do Stripe. O sistema nunca inventa um ID do Stripe:
 * os campos ficam vazios ate serem informados aqui.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PlanEntitlements, PlanPagePlan, PlanPageService, PlansPagePayload } from "../lib/plans-page";
import { formatPlanPrice, isFreePlan, isQuotePlan } from "../lib/plans-page";
import { getCurrentAuthSession } from "../lib/supabaseAuth";

const DEFAULT_ENTITLEMENTS: PlanEntitlements = {
  AI_MONTHLY_LIMIT: 0,
  AI_IMAGES: false,
  REPORTS: false,
  PROPERTY_HISTORY: false,
  TECHNICAL_OPINIONS_MONTHLY: 0,
  HUMAN_VALIDATION: false,
  CASE_ANALYSIS_MONTHLY: 0,
  IMAGE_TRIAGE_MONTHLY: 0,
  SOIL_ANALYSIS_UPLOAD: false
};

const TECHNICAL_OPINION_SERVICE_TYPE = "technical_opinion_single";

function listValue(value: string[]) {
  return value.join("\n");
}

function parseList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateItem<T extends object>(items: T[], index: number, changes: Partial<T>) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item));
}

function moneyInput(value: number) {
  return (value / 100).toFixed(2).replace(".", ",");
}

function parseMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function parseCount(value: string) {
  const parsed = Number(value.replace(/\D/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

const fieldClass =
  "mt-2 w-full rounded-2xl border border-leaf-100 px-4 py-3 text-sm outline-none transition focus:border-leaf-400 focus:ring-4 focus:ring-leaf-100";

function Field({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  required = true,
  hint,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      {multiline ? (
        <textarea
          required={required}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={fieldClass}
        />
      ) : (
        <input
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={fieldClass}
        />
      )}
      {hint && <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#2F7D4A]"
      />
      {label}
    </label>
  );
}

function EntitlementsEditor({
  entitlements,
  onChange,
  showTechnicalOpinions
}: {
  entitlements: PlanEntitlements;
  onChange: (changes: Partial<PlanEntitlements>) => void;
  showTechnicalOpinions: boolean;
}) {
  return (
    <div className="mt-5 rounded-3xl border border-leaf-100 bg-leaf-50/50 p-4">
      <p className="text-sm font-bold text-slate-900">Direitos do plano</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        Estes valores sao a unica fonte das regras comerciais. Alterar aqui muda o comportamento do sistema inteiro, sem
        precisar de nova versao do codigo.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Consultas a IA por mes"
          value={String(entitlements.AI_MONTHLY_LIMIT ?? 0)}
          onChange={(value) => onChange({ AI_MONTHLY_LIMIT: parseCount(value) })}
          hint="Quantidade mensal de perguntas a IA."
        />
        {showTechnicalOpinions && (
          <Field
            label="Pareceres tecnicos por mes"
            value={String(entitlements.TECHNICAL_OPINIONS_MONTHLY)}
            onChange={(value) => onChange({ TECHNICAL_OPINIONS_MONTHLY: parseCount(value) })}
            hint="1 parecer = 1 demanda tecnica. Mensagens da mesma demanda nao consomem pareceres."
          />
        )}
        <Field
          label="Analises de caso por mes"
          value={String(entitlements.CASE_ANALYSIS_MONTHLY ?? 0)}
          onChange={(value) => onChange({ CASE_ANALYSIS_MONTHLY: parseCount(value) })}
        />
        <Field
          label="Triagens de imagem por mes"
          value={String(entitlements.IMAGE_TRIAGE_MONTHLY ?? 0)}
          onChange={(value) => onChange({ IMAGE_TRIAGE_MONTHLY: parseCount(value) })}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <Toggle label="Analise de fotos" checked={entitlements.AI_IMAGES} onChange={(value) => onChange({ AI_IMAGES: value })} />
        <Toggle label="Relatorios" checked={entitlements.REPORTS} onChange={(value) => onChange({ REPORTS: value })} />
        <Toggle
          label="Historico da propriedade"
          checked={entitlements.PROPERTY_HISTORY}
          onChange={(value) => onChange({ PROPERTY_HISTORY: value })}
        />
        <Toggle
          label="Upload de analise de solo"
          checked={entitlements.SOIL_ANALYSIS_UPLOAD}
          onChange={(value) => onChange({ SOIL_ANALYSIS_UPLOAD: value })}
        />
        <Toggle
          label="Validacao por especialista"
          checked={entitlements.HUMAN_VALIDATION}
          onChange={(value) => onChange({ HUMAN_VALIDATION: value })}
        />
      </div>
    </div>
  );
}

function PlanEditor({ plan, index, onChange }: { plan: PlanPagePlan; index: number; onChange: (changes: Partial<PlanPagePlan>) => void }) {
  const entitlements = plan.entitlements ?? DEFAULT_ENTITLEMENTS;
  const quote = isQuotePlan(plan);
  const free = isFreePlan(plan) && !quote;
  const chargeable = !quote && !free;

  return (
    <article className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-col gap-3 border-b border-leaf-50 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">Plano {index + 1}</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">{plan.name || "Novo plano"}</h2>
          <p className="mt-1 text-xs text-slate-500">
            Code de contratacao: {plan.slug}
            {plan.is_legacy ? " · plano legado (preservado para quem ja assina)" : ""}
          </p>
        </div>
        <Toggle label="Plano ativo" checked={plan.active} onChange={(value) => onChange({ active: value })} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Nome do plano" value={plan.name} onChange={(value) => onChange({ name: value })} />
        <Field label="Destaque superior" value={plan.eyebrow} onChange={(value) => onChange({ eyebrow: value })} required={false} />
        <Field
          label="Publico / indicacao"
          value={plan.audience}
          onChange={(value) => onChange({ audience: value })}
          multiline
          rows={3}
          required={false}
        />
        <Field
          label="Descricao do plano"
          value={plan.description}
          onChange={(value) => onChange({ description: value })}
          multiline
          rows={3}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label={quote ? "Preco (mantenha 0,00)" : "Preco exibido (R$)"}
          value={moneyInput(plan.price_cents)}
          onChange={(value) => onChange({ price_cents: parseMoney(value) })}
          hint={quote ? "Categoria sob consulta: nao definimos preco." : undefined}
        />
        <Field label="Prefixo do preco" value={plan.price_prefix} onChange={(value) => onChange({ price_prefix: value })} required={false} />
        <Field label="Periodicidade" value={plan.price_period} onChange={(value) => onChange({ price_period: value })} required={false} />
        <Field
          label={quote ? "Texto no lugar do preco" : "Complemento do preco"}
          value={plan.price_note}
          onChange={(value) => onChange({ price_note: value })}
          required={false}
          placeholder={quote ? "Sob consulta" : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field
          label={quote ? "Tipos de servico (um por linha)" : "Recursos (um por linha)"}
          value={listValue(plan.features)}
          onChange={(value) => onChange({ features: parseList(value) })}
          multiline
          rows={7}
        />
        <Field
          label="Nao inclui (um por linha)"
          value={listValue(plan.exclusions)}
          onChange={(value) => onChange({ exclusions: parseList(value) })}
          multiline
          rows={7}
          required={false}
        />
      </div>

      {chargeable && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field
            label="Stripe Product ID"
            value={plan.stripe_product_id ?? ""}
            onChange={(value) => onChange({ stripe_product_id: value || null })}
            required={false}
            placeholder="prod_..."
            hint="Informe o ID real criado no painel do Stripe."
          />
          <Field
            label="Stripe Price ID"
            value={plan.stripe_price_id ?? ""}
            onChange={(value) => onChange({ stripe_price_id: value || null })}
            required={false}
            placeholder="price_..."
            hint="Necessario para upgrade/downgrade com cobranca proporcional."
          />
        </div>
      )}

      <EntitlementsEditor
        entitlements={entitlements}
        showTechnicalOpinions={!quote}
        onChange={(changes) => onChange({ entitlements: { ...entitlements, ...changes } })}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Texto do botao (CTA)" value={plan.button_label} onChange={(value) => onChange({ button_label: value })} />
        <Field
          label="Badge de destaque"
          value={plan.badge || ""}
          onChange={(value) => onChange({ badge: value || null })}
          required={false}
        />
        <Field
          label="Ordem"
          value={String(plan.display_order)}
          onChange={(value) => onChange({ display_order: Math.max(0, Number(value) || 0) })}
        />
        <div className="flex items-end pb-3">
          <Toggle label="Destacar visualmente" checked={plan.highlighted} onChange={(value) => onChange({ highlighted: value })} />
        </div>
      </div>
    </article>
  );
}

function ServiceEditor({
  service,
  index,
  onChange
}: {
  service: PlanPageService;
  index: number;
  onChange: (changes: Partial<PlanPageService>) => void;
}) {
  const isTechnicalOpinion = service.service_type === TECHNICAL_OPINION_SERVICE_TYPE;

  return (
    <article
      className={`rounded-3xl border p-5 shadow-soft sm:p-6 ${
        isTechnicalOpinion ? "border-leaf-300 bg-leaf-50/40" : "border-leaf-100 bg-white"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-leaf-700">
            {isTechnicalOpinion ? "Parecer Tecnico Avulso" : `Servico ${index + 1}`}
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-950">{service.name}</h3>
          <p className="mt-1 text-xs text-slate-500">Tipo preservado para o checkout: {service.service_type}</p>
          {isTechnicalOpinion && (
            <p className="mt-2 text-xs leading-5 text-slate-600">
              So fica disponivel na pagina publica quando estiver ativo e com preco maior que zero.
            </p>
          )}
        </div>
        <Toggle label="Servico ativo" checked={service.active} onChange={(value) => onChange({ active: value })} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Nome" value={service.name} onChange={(value) => onChange({ name: value })} />
        <Field
          label="Descricao"
          value={service.description}
          onChange={(value) => onChange({ description: value })}
          multiline
          rows={3}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Preco (R$)" value={moneyInput(service.price_cents)} onChange={(value) => onChange({ price_cents: parseMoney(value) })} />
        <Field label="Prefixo" value={service.price_prefix} onChange={(value) => onChange({ price_prefix: value })} required={false} />
        <Field label="Periodicidade" value={service.price_period} onChange={(value) => onChange({ price_period: value })} required={false} />
        <Field label="Texto do botao" value={service.button_label} onChange={(value) => onChange({ button_label: value })} />
        <Field
          label="Ordem"
          value={String(service.display_order)}
          onChange={(value) => onChange({ display_order: Math.max(0, Number(value) || 0) })}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field
          label="Stripe Product ID"
          value={service.stripe_product_id ?? ""}
          onChange={(value) => onChange({ stripe_product_id: value || null })}
          required={false}
          placeholder="prod_..."
        />
        <Field
          label="Stripe Price ID"
          value={service.stripe_price_id ?? ""}
          onChange={(value) => onChange({ stripe_price_id: value || null })}
          required={false}
          placeholder="price_..."
        />
      </div>
    </article>
  );
}

export default function AdminPlansPage() {
  const [data, setData] = useState<PlansPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const session = await getCurrentAuthSession();
        if (!session?.access_token) throw new Error("Sessao expirada. Faca login novamente.");
        const response = await fetch("/api/admin/plans-page", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store"
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar a configuracao.");

        const normalized = payload as PlansPagePayload;
        normalized.plans = normalized.plans.map((plan) => ({
          ...plan,
          entitlements: { ...DEFAULT_ENTITLEMENTS, ...(plan.entitlements ?? {}) }
        }));
        setData(normalized);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Nao foi possivel carregar a configuracao.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activePlans = useMemo(() => data?.plans.filter((plan) => plan.active) ?? [], [data]);

  function updateSettings(field: keyof PlansPagePayload["settings"], value: string | string[]) {
    setData((current) => (current ? { ...current, settings: { ...current.settings, [field]: value } } : current));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const session = await getCurrentAuthSession();
      if (!session?.access_token) throw new Error("Sessao expirada. Faca login novamente.");
      const response = await fetch("/api/admin/plans-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(data)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel salvar a configuracao.");
      setMessage(payload?.message || "Configuracao salva com sucesso.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel salvar a configuracao.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-16" aria-busy="true">
        Carregando configuracao dos planos...
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-16">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900" role="alert">
          {error}
        </div>
      </section>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-14 lg:py-20">
      <Link href="/configuracoes" className="text-sm font-semibold text-leaf-700">
        ← Voltar para Configuracoes
      </Link>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-3 inline-flex rounded-full bg-leaf-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
            ⚙️ Area administrativa
          </p>
          <h1 className="text-2xl font-black text-[#123F2A] sm:text-4xl">Configuracao dos planos</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Conteudo comercial, limites e identificadores Stripe da pagina publica. Precos vao para o servidor em centavos e
            os IDs do Stripe precisam ser os reais, criados no painel do Stripe.
          </p>
        </div>
        <Link
          href="/planos"
          target="_blank"
          className="rounded-full border border-leaf-200 bg-white px-4 py-2 text-center text-sm font-semibold text-leaf-700 shadow-sm hover:bg-leaf-50"
        >
          Abrir pagina publica ↗
        </Link>
      </div>

      {message && (
        <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-8 grid gap-8">
        <div className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6">
          <h2 className="text-xl font-bold text-slate-950">Conteudo geral</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Chamada superior" value={data.settings.eyebrow} onChange={(value) => updateSettings("eyebrow", value)} />
            <Field label="Titulo principal" value={data.settings.title} onChange={(value) => updateSettings("title", value)} />
            <Field label="Subtitulo" value={data.settings.subtitle} onChange={(value) => updateSettings("subtitle", value)} multiline rows={3} />
            <Field label="Rotulo da estrategia" value={data.settings.strategy_label} onChange={(value) => updateSettings("strategy_label", value)} />
            <Field label="Descricao introdutoria" value={data.settings.intro} onChange={(value) => updateSettings("intro", value)} multiline rows={5} />
            <Field label="Titulo da estrategia" value={data.settings.strategy_title} onChange={(value) => updateSettings("strategy_title", value)} multiline rows={3} />
            <Field
              label="Textos de destaque (um por linha)"
              value={listValue(data.settings.value_phrases)}
              onChange={(value) => updateSettings("value_phrases", parseList(value))}
              multiline
              rows={5}
            />
            <Field
              label="Itens da estrategia (um por linha)"
              value={listValue(data.settings.strategy_items)}
              onChange={(value) => updateSettings("strategy_items", parseList(value))}
              multiline
              rows={5}
            />
            <Field label="Aviso legal" value={data.settings.legal_notice} onChange={(value) => updateSettings("legal_notice", value)} multiline rows={3} />
            <Field
              label="Aviso do plano gratuito"
              value={data.settings.free_plan_notice}
              onChange={(value) => updateSettings("free_plan_notice", value)}
              multiline
              rows={3}
            />
            <Field label="Rotulo do comparativo" value={data.settings.comparison_label} onChange={(value) => updateSettings("comparison_label", value)} />
            <Field
              label="Descricao do comparativo"
              value={data.settings.comparison_description}
              onChange={(value) => updateSettings("comparison_description", value)}
              multiline
              rows={3}
            />
          </div>
        </div>

        <div className="grid gap-5">
          {data.plans.map((plan, index) => (
            <PlanEditor
              key={plan.id}
              plan={plan}
              index={index}
              onChange={(changes) =>
                setData((current) => (current ? { ...current, plans: updateItem(current.plans, index, changes) } : current))
              }
            />
          ))}
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-5 shadow-soft sm:p-6">
          <h2 className="text-xl font-bold text-slate-950">Atendimento pontual e servicos avulsos</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Titulo do bloco pontual" value={data.settings.onetime_title} onChange={(value) => updateSettings("onetime_title", value)} />
            <Field
              label="Botao do bloco pontual"
              value={data.settings.onetime_button_label}
              onChange={(value) => updateSettings("onetime_button_label", value)}
            />
            <Field
              label="Descricao do bloco pontual"
              value={data.settings.onetime_description}
              onChange={(value) => updateSettings("onetime_description", value)}
              multiline
              rows={3}
            />
            <Field
              label="Botao de orcamento (Presencial)"
              value={data.settings.quote_button_label}
              onChange={(value) => updateSettings("quote_button_label", value)}
            />
            <Field
              label="Servicos presenciais (um por linha)"
              value={listValue(data.settings.quote_services)}
              onChange={(value) => updateSettings("quote_services", parseList(value))}
              multiline
              rows={7}
            />
            <div className="grid gap-4">
              <Field label="Chamada da secao de consultorias" value={data.settings.consulting_eyebrow} onChange={(value) => updateSettings("consulting_eyebrow", value)} />
              <Field label="Titulo da secao de consultorias" value={data.settings.consulting_title} onChange={(value) => updateSettings("consulting_title", value)} />
            </div>
            <Field
              label="Descricao das consultorias"
              value={data.settings.consulting_description}
              onChange={(value) => updateSettings("consulting_description", value)}
              multiline
              rows={4}
            />
            <Field
              label="Aviso das consultorias"
              value={data.settings.consulting_notice}
              onChange={(value) => updateSettings("consulting_notice", value)}
              multiline
              rows={3}
            />
          </div>

          <div className="mt-5 grid gap-5">
            {data.services.map((service, index) => (
              <ServiceEditor
                key={service.service_type}
                service={service}
                index={index}
                onChange={(changes) =>
                  setData((current) => (current ? { ...current, services: updateItem(current.services, index, changes) } : current))
                }
              />
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-leaf-200 bg-leaf-50/60 p-5 shadow-soft sm:p-6">
          <h2 className="text-xl font-bold text-slate-950">Pre-visualizacao rapida</h2>
          <p className="mt-1 text-sm text-slate-600">A amostra usa os dados atuais do formulario; salve para publicar.</p>
          <div className="mt-4 rounded-3xl border border-white bg-white p-5">
            <h3 className="text-2xl font-black text-slate-950">{data.settings.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{data.settings.subtitle}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {activePlans.map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-leaf-100 bg-slate-50 p-4">
                  <p className="text-sm font-bold text-slate-950">{plan.name}</p>
                  <p className="mt-2 text-lg font-black text-leaf-800">{formatPlanPrice(plan)}</p>
                  <p className="mt-2 text-xs text-slate-600">{plan.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="justify-self-start rounded-full bg-leaf-700 px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar configuracao"}
        </button>
      </form>
    </section>
  );
}

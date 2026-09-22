/**
 * Administracao dos planos e servicos da PlantaSa.
 *
 * Restrito a administradores (verificado no servidor, nao apenas na interface).
 * Permite configurar nome, descricao, preco exibido, recursos, limites
 * (entitlements) e os identificadores Stripe de cada plano/servico. Nenhum ID
 * do Stripe e inventado pelo sistema: eles sao informados aqui.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../lib/agronomic/case";
import type {
  PlanEntitlements,
  PlanPagePlan,
  PlanPageService,
  PlanPageSettings,
  PlansPagePayload,
} from "../../../../lib/plans-page";

export const dynamic = "force-dynamic";

const SERVICE_TYPES = new Set([
  "human_case_review",
  "soil_analysis_review",
  "technical_report",
  "monthly_farm_followup",
  "technical_opinion_single",
]);

function getToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}

async function ensureAdmin(token: string) {
  const user = await getAuthenticatedUser(token);
  const profiles = await supabaseRequest<Array<{ role?: string; status?: string | null }>>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`,
    { method: "GET" },
    token,
  );
  const profile = profiles[0];

  if (profile?.role !== "admin" || (profile.status ?? "active") !== "active") {
    return null;
  }

  return user;
}

function text(value: unknown, field: string, maxLength: number, required = true) {
  if (!required && (value === null || value === undefined)) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`${field} invalido.`);
  }

  const normalized = value.trim();
  if (required && !normalized) {
    throw new Error(`${field} e obrigatorio.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} excede o limite de ${maxLength} caracteres.`);
  }
  return normalized;
}

function textList(value: unknown, field: string, maxItems = 30) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} deve ser uma lista valida.`);
  }

  return value.map((item) => text(item, field, 300));
}

function cents(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new Error(`${field} deve ser informado em centavos, como um numero inteiro nao negativo.`);
  }
  return value;
}

function order(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} invalida.`);
  }
  return value;
}

function booleanValue(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${field} invalido.`);
  }
  return value;
}

/** Identificadores Stripe: aceitos apenas no formato do Stripe, ou vazios. */
function stripeId(value: unknown, field: string, prefix: "prod_" | "price_") {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} invalido.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (!normalized.startsWith(prefix) || normalized.length > 255 || /\s/.test(normalized)) {
    throw new Error(`${field} deve comecar com "${prefix}" e ser o identificador real gerado no Stripe.`);
  }

  return normalized;
}

function limitValue(value: unknown, field: string) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${field} deve ser um numero inteiro nao negativo, ou nulo para ilimitado.`);
  }
  return value;
}

function countValue(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${field} deve ser um numero inteiro nao negativo.`);
  }
  return value;
}

function entitlements(value: unknown, field: string): PlanEntitlements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} invalidos.`);
  }

  const raw = value as Record<string, unknown>;

  return {
    AI_MONTHLY_LIMIT: limitValue(raw.AI_MONTHLY_LIMIT ?? 0, `${field}: consultas de IA por mes`),
    AI_IMAGES: booleanValue(raw.AI_IMAGES ?? false, `${field}: analise de fotos`),
    REPORTS: booleanValue(raw.REPORTS ?? false, `${field}: relatorios`),
    PROPERTY_HISTORY: booleanValue(raw.PROPERTY_HISTORY ?? false, `${field}: historico da propriedade`),
    TECHNICAL_OPINIONS_MONTHLY: countValue(raw.TECHNICAL_OPINIONS_MONTHLY ?? 0, `${field}: pareceres por mes`),
    HUMAN_VALIDATION: booleanValue(raw.HUMAN_VALIDATION ?? false, `${field}: validacao por especialista`),
    CASE_ANALYSIS_MONTHLY: limitValue(raw.CASE_ANALYSIS_MONTHLY ?? 0, `${field}: analises de caso por mes`),
    IMAGE_TRIAGE_MONTHLY: limitValue(raw.IMAGE_TRIAGE_MONTHLY ?? 0, `${field}: triagens de imagem por mes`),
    SOIL_ANALYSIS_UPLOAD: booleanValue(raw.SOIL_ANALYSIS_UPLOAD ?? false, `${field}: upload de analise de solo`),
  };
}

function validatePayload(input: unknown): PlansPagePayload {
  if (!input || typeof input !== "object") {
    throw new Error("Configuracao invalida.");
  }

  const raw = input as Record<string, unknown>;
  const rawSettings = raw.settings;
  const rawPlans = raw.plans;
  const rawServices = raw.services;

  if (!rawSettings || typeof rawSettings !== "object" || !Array.isArray(rawPlans) || !Array.isArray(rawServices)) {
    throw new Error("Informe configuracoes, planos e servicos validos.");
  }

  const settings = rawSettings as Record<string, unknown>;
  const plans = rawPlans.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Plano ${index + 1} invalido.`);
    const plan = item as Record<string, unknown>;
    const planKind = typeof plan.plan_kind === "string" ? plan.plan_kind : "subscription";
    const priceCents = cents(plan.price_cents, `Preco do plano ${index + 1}`);

    if (planKind === "subscription" && plan.active === true && priceCents <= 0) {
      throw new Error(`O plano ${index + 1} e recorrente e precisa de um preco maior que zero.`);
    }

    return {
      id: text(plan.id, `ID do plano ${index + 1}`, 80),
      name: text(plan.name, `Nome do plano ${index + 1}`, 120),
      slug: text(plan.slug, `Slug do plano ${index + 1}`, 80),
      eyebrow: text(plan.eyebrow, `Destaque do plano ${index + 1}`, 120, false),
      audience: text(plan.audience, `Publico do plano ${index + 1}`, 500, false),
      description: text(plan.description, `Descricao do plano ${index + 1}`, 1000),
      price_cents: priceCents,
      billing_type: typeof plan.billing_type === "string" ? plan.billing_type : null,
      plan_kind: planKind,
      price_prefix: text(plan.price_prefix, `Prefixo de preco do plano ${index + 1}`, 40, false),
      price_period: text(plan.price_period, `Periodicidade do plano ${index + 1}`, 40, false),
      price_note: text(plan.price_note, `Observacao de preco do plano ${index + 1}`, 300, false),
      features: textList(plan.features, `Beneficios do plano ${index + 1}`),
      exclusions: textList(plan.exclusions, `Exclusoes do plano ${index + 1}`),
      entitlements: entitlements(plan.entitlements, `Direitos do plano ${index + 1}`),
      stripe_product_id: stripeId(plan.stripe_product_id, `Stripe Product ID do plano ${index + 1}`, "prod_"),
      stripe_price_id: stripeId(plan.stripe_price_id, `Stripe Price ID do plano ${index + 1}`, "price_"),
      button_label: text(plan.button_label, `Botao do plano ${index + 1}`, 80),
      highlighted: booleanValue(plan.highlighted, `Destaque visual do plano ${index + 1}`),
      badge: text(plan.badge, `Badge do plano ${index + 1}`, 80, false),
      active: booleanValue(plan.active, `Status do plano ${index + 1}`),
      display_order: order(plan.display_order, `Ordem do plano ${index + 1}`),
    };
  });

  const services = rawServices.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Servico ${index + 1} invalido.`);
    const service = item as Record<string, unknown>;
    const serviceType = text(service.service_type, `Tipo do servico ${index + 1}`, 80);
    if (!SERVICE_TYPES.has(serviceType)) throw new Error(`Tipo do servico ${index + 1} nao suportado.`);
    const priceCents = cents(service.price_cents, `Preco do servico ${index + 1}`);

    if (service.active === true && priceCents <= 0) {
      throw new Error(`O servico ${index + 1} so pode ser ativado com um preco maior que zero.`);
    }

    return {
      service_type: serviceType,
      name: text(service.name, `Nome do servico ${index + 1}`, 160),
      price_cents: priceCents,
      price_prefix: text(service.price_prefix, `Prefixo do servico ${index + 1}`, 40, false),
      price_period: text(service.price_period, `Periodicidade do servico ${index + 1}`, 40, false),
      description: text(service.description, `Descricao do servico ${index + 1}`, 1000),
      button_label: text(service.button_label, `Botao do servico ${index + 1}`, 80),
      stripe_product_id: stripeId(service.stripe_product_id, `Stripe Product ID do servico ${index + 1}`, "prod_"),
      stripe_price_id: stripeId(service.stripe_price_id, `Stripe Price ID do servico ${index + 1}`, "price_"),
      active: booleanValue(service.active, `Status do servico ${index + 1}`),
      display_order: order(service.display_order, `Ordem do servico ${index + 1}`),
    };
  });

  if (plans.length === 0 || plans.length > 30 || services.length === 0 || services.length > SERVICE_TYPES.size) {
    throw new Error("A pagina precisa conter uma quantidade valida de planos e servicos.");
  }

  return {
    settings: {
      id: true,
      eyebrow: text(settings.eyebrow, "Chamada superior", 160),
      title: text(settings.title, "Titulo da pagina", 160),
      subtitle: text(settings.subtitle, "Subtitulo da pagina", 500),
      intro: text(settings.intro, "Descricao introdutoria", 2000),
      value_phrases: textList(settings.value_phrases, "Textos de destaque", 10),
      strategy_label: text(settings.strategy_label, "Rotulo da estrategia", 120),
      strategy_title: text(settings.strategy_title, "Titulo da estrategia", 300),
      strategy_items: textList(settings.strategy_items, "Itens da estrategia", 10),
      legal_notice: text(settings.legal_notice, "Aviso legal", 1000),
      free_plan_notice: text(settings.free_plan_notice, "Aviso do plano gratuito", 1000),
      comparison_label: text(settings.comparison_label, "Rotulo do comparativo", 120),
      comparison_description: text(settings.comparison_description, "Descricao do comparativo", 500),
      consulting_eyebrow: text(settings.consulting_eyebrow, "Chamada de consultorias", 120),
      consulting_title: text(settings.consulting_title, "Titulo de consultorias", 200),
      consulting_description: text(settings.consulting_description, "Descricao de consultorias", 1000),
      consulting_notice: text(settings.consulting_notice, "Aviso de consultorias", 500),
      onetime_title: text(settings.onetime_title, "Titulo do atendimento pontual", 200),
      onetime_description: text(settings.onetime_description, "Descricao do atendimento pontual", 1000),
      onetime_button_label: text(settings.onetime_button_label, "Botao do atendimento pontual", 80),
      quote_button_label: text(settings.quote_button_label, "Botao de orcamento", 80),
      quote_services: textList(settings.quote_services, "Servicos presenciais", 20),
    },
    plans,
    services,
  } as PlansPagePayload;
}

const ADMIN_PLAN_FIELDS =
  "id,name,slug,eyebrow,audience,description,price_cents,billing_type,plan_kind,price_prefix,price_period,price_note,features,exclusions,entitlements,button_label,highlighted,badge,active,display_order,stripe_product_id,stripe_price_id,is_legacy,updated_at";

const ADMIN_SERVICE_FIELDS =
  "service_type,name,price_cents,price_prefix,price_period,description,button_label,active,display_order,stripe_product_id,stripe_price_id,updated_at";

async function readAdminData(token: string): Promise<PlansPagePayload> {
  const [settings, plans, services] = await Promise.all([
    supabaseRequest<PlanPageSettings[]>("/rest/v1/plan_page_settings?id=eq.true&select=*&limit=1", { method: "GET" }, token),
    supabaseRequest<PlanPagePlan[]>(
      `/rest/v1/plans?select=${ADMIN_PLAN_FIELDS}&order=display_order.asc,created_at.asc`,
      { method: "GET" },
      token,
    ),
    supabaseRequest<PlanPageService[]>(
      `/rest/v1/plan_page_services?select=${ADMIN_SERVICE_FIELDS}&order=display_order.asc,created_at.asc`,
      { method: "GET" },
      token,
    ),
  ]);

  if (!settings[0]) throw new Error("A configuracao da pagina de Planos ainda nao foi criada.");
  return { settings: settings[0], plans, services };
}

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    if (!(await ensureAdmin(token))) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
    return NextResponse.json(await readAdminData(token), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao foi possivel carregar a configuracao." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    if (!(await ensureAdmin(token))) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });

    const payload = validatePayload(await request.json().catch(() => null));
    await supabaseRequest("/rest/v1/rpc/update_plans_page", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ p_payload: payload }),
    }, token);

    return NextResponse.json({ message: "Configuracao dos planos salva com sucesso." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel salvar a configuracao.";
    const status = /acesso|permiss|administrador/i.test(message)
      ? 403
      : /inval|obrigat|excede|preco|ordem|status|tipo|quantidade|stripe|numero/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

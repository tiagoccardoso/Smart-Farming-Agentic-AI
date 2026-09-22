import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../lib/agronomic/case";
import type { PlanPagePlan, PlanPageService, PlanPageSettings, PlansPagePayload } from "../../../../lib/plans-page";

export const dynamic = "force-dynamic";

const SERVICE_TYPES = new Set([
  "human_case_review",
  "soil_analysis_review",
  "technical_report",
  "monthly_farm_followup",
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
    throw new Error(`${field} inválido.`);
  }

  const normalized = value.trim();
  if (required && !normalized) {
    throw new Error(`${field} é obrigatório.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} excede o limite de ${maxLength} caracteres.`);
  }
  return normalized;
}

function textList(value: unknown, field: string, maxItems = 30) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} deve ser uma lista válida.`);
  }

  return value.map((item) => text(item, field, 300));
}

function cents(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new Error(`${field} deve ser informado em centavos, como um número inteiro não negativo.`);
  }
  return value;
}

function order(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} inválida.`);
  }
  return value;
}

function booleanValue(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${field} inválido.`);
  }
  return value;
}

function validatePayload(input: unknown): PlansPagePayload {
  if (!input || typeof input !== "object") {
    throw new Error("Configuração inválida.");
  }

  const raw = input as Record<string, unknown>;
  const rawSettings = raw.settings;
  const rawPlans = raw.plans;
  const rawServices = raw.services;

  if (!rawSettings || typeof rawSettings !== "object" || !Array.isArray(rawPlans) || !Array.isArray(rawServices)) {
    throw new Error("Informe configurações, planos e serviços válidos.");
  }

  const settings = rawSettings as Record<string, unknown>;
  const plans = rawPlans.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Plano ${index + 1} inválido.`);
    const plan = item as Record<string, unknown>;
    return {
      id: text(plan.id, `ID do plano ${index + 1}`, 80),
      name: text(plan.name, `Nome do plano ${index + 1}`, 120),
      slug: text(plan.slug, `Slug do plano ${index + 1}`, 80),
      eyebrow: text(plan.eyebrow, `Destaque do plano ${index + 1}`, 120),
      audience: text(plan.audience, `Público do plano ${index + 1}`, 500),
      description: text(plan.description, `Descrição do plano ${index + 1}`, 1000),
      price_cents: cents(plan.price_cents, `Preço do plano ${index + 1}`),
      billing_type: typeof plan.billing_type === "string" ? plan.billing_type : null,
      price_prefix: text(plan.price_prefix, `Prefixo de preço do plano ${index + 1}`, 40, false),
      price_period: text(plan.price_period, `Periodicidade do plano ${index + 1}`, 40, false),
      price_note: text(plan.price_note, `Observação de preço do plano ${index + 1}`, 300, false),
      features: textList(plan.features, `Benefícios do plano ${index + 1}`),
      exclusions: textList(plan.exclusions, `Exclusões do plano ${index + 1}`),
      button_label: text(plan.button_label, `Botão do plano ${index + 1}`, 80),
      highlighted: booleanValue(plan.highlighted, `Destaque visual do plano ${index + 1}`),
      badge: text(plan.badge, `Badge do plano ${index + 1}`, 80, false),
      active: booleanValue(plan.active, `Status do plano ${index + 1}`),
      display_order: order(plan.display_order, `Ordem do plano ${index + 1}`),
    };
  });

  const services = rawServices.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Serviço ${index + 1} inválido.`);
    const service = item as Record<string, unknown>;
    const serviceType = text(service.service_type, `Tipo do serviço ${index + 1}`, 80);
    if (!SERVICE_TYPES.has(serviceType)) throw new Error(`Tipo do serviço ${index + 1} não suportado.`);
    return {
      service_type: serviceType,
      name: text(service.name, `Nome do serviço ${index + 1}`, 160),
      price_cents: cents(service.price_cents, `Preço do serviço ${index + 1}`),
      price_prefix: text(service.price_prefix, `Prefixo do serviço ${index + 1}`, 40, false),
      price_period: text(service.price_period, `Periodicidade do serviço ${index + 1}`, 40, false),
      description: text(service.description, `Descrição do serviço ${index + 1}`, 1000),
      button_label: text(service.button_label, `Botão do serviço ${index + 1}`, 80),
      active: booleanValue(service.active, `Status do serviço ${index + 1}`),
      display_order: order(service.display_order, `Ordem do serviço ${index + 1}`),
    };
  });

  if (plans.length === 0 || plans.length > 30 || services.length === 0 || services.length > SERVICE_TYPES.size) {
    throw new Error("A página precisa conter uma quantidade válida de planos e serviços.");
  }

  return {
    settings: {
      id: true,
      eyebrow: text(settings.eyebrow, "Chamada superior", 160),
      title: text(settings.title, "Título da página", 160),
      subtitle: text(settings.subtitle, "Subtítulo da página", 500),
      intro: text(settings.intro, "Descrição introdutória", 2000),
      value_phrases: textList(settings.value_phrases, "Textos de destaque", 10),
      strategy_label: text(settings.strategy_label, "Rótulo da estratégia", 120),
      strategy_title: text(settings.strategy_title, "Título da estratégia", 300),
      strategy_items: textList(settings.strategy_items, "Itens da estratégia", 10),
      legal_notice: text(settings.legal_notice, "Aviso legal", 1000),
      free_plan_notice: text(settings.free_plan_notice, "Aviso do plano gratuito", 1000),
      comparison_label: text(settings.comparison_label, "Rótulo do comparativo", 120),
      comparison_description: text(settings.comparison_description, "Descrição do comparativo", 500),
      consulting_eyebrow: text(settings.consulting_eyebrow, "Chamada de consultorias", 120),
      consulting_title: text(settings.consulting_title, "Título de consultorias", 200),
      consulting_description: text(settings.consulting_description, "Descrição de consultorias", 1000),
      consulting_notice: text(settings.consulting_notice, "Aviso de consultorias", 500),
    },
    plans,
    services,
  } as PlansPagePayload;
}

async function readAdminData(token: string): Promise<PlansPagePayload> {
  const [settings, plans, services] = await Promise.all([
    supabaseRequest<PlanPageSettings[]>("/rest/v1/plan_page_settings?id=eq.true&select=*&limit=1", { method: "GET" }, token),
    supabaseRequest<PlanPagePlan[]>(
      "/rest/v1/plans?select=id,name,slug,eyebrow,audience,description,price_cents,billing_type,price_prefix,price_period,price_note,features,exclusions,button_label,highlighted,badge,active,display_order,stripe_price_id,updated_at&order=display_order.asc,created_at.asc",
      { method: "GET" },
      token,
    ),
    supabaseRequest<PlanPageService[]>(
      "/rest/v1/plan_page_services?select=service_type,name,price_cents,price_prefix,price_period,description,button_label,active,display_order,updated_at&order=display_order.asc,created_at.asc",
      { method: "GET" },
      token,
    ),
  ]);

  if (!settings[0]) throw new Error("A configuração da página de Planos ainda não foi criada.");
  return { settings: settings[0], plans, services };
}

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (!(await ensureAdmin(token))) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
    return NextResponse.json(await readAdminData(token), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar a configuração." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (!(await ensureAdmin(token))) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });

    const payload = validatePayload(await request.json().catch(() => null));
    await supabaseRequest("/rest/v1/rpc/update_plans_page", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ p_payload: payload }),
    }, token);

    return NextResponse.json({ message: "Configuração da página de Planos salva com sucesso." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a configuração.";
    const status = /acesso|permissão|administrador/i.test(message) ? 403 : /inválid|obrigatór|excede|preço|ordem|status|tipo|quantidade/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Resolução de direitos por plano (itens 11, 16 e 17 do escopo).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveUserAccess } from "../lib/billing/entitlements";
import { CONSULTING_PLAN_ROW, FREE_PLAN_ROW, LEGACY_PLAN_ROW, subscriptionRow } from "./helpers/fixtures";
import { installFetchMock, setTestEnv } from "./helpers/http-mock";

setTestEnv();

type Options = { profile?: Record<string, unknown>; subscriptions?: unknown[]; plans?: Record<string, unknown>[] };

function mockBackend(options: Options = {}) {
  const plans = options.plans ?? [FREE_PLAN_ROW, CONSULTING_PLAN_ROW, LEGACY_PLAN_ROW];

  return installFetchMock((call) => {
    if (call.url.includes("/rest/v1/profiles")) {
      return { body: [options.profile ?? { status: "active", unlimited_access: false }] };
    }

    if (call.url.includes("/rest/v1/subscriptions")) {
      return { body: options.subscriptions ?? [] };
    }

    if (call.url.includes("/rest/v1/plans")) {
      const match = /slug=eq\.([^&]+)/.exec(call.url);
      const slug = match ? decodeURIComponent(match[1]) : null;
      return { body: plans.filter((plan) => !slug || plan.slug === slug) };
    }

    return { body: [] };
  });
}

test("usuário sem assinatura fica no plano Gratuito com 3 consultas", async () => {
  const mock = mockBackend();

  try {
    const access = await resolveUserAccess("user-1");
    assert.equal(access.planCode, "gratuito");
    assert.equal(access.entitlements.AI_MONTHLY_LIMIT, 3);
    assert.equal(access.entitlements.TECHNICAL_OPINIONS_MONTHLY, 0);
    assert.equal(access.entitlements.AI_IMAGES, false);
  } finally {
    mock.restore();
  }
});

test("Consultoria Agronômica ativa libera 3 pareceres e validação humana", async () => {
  const mock = mockBackend({ subscriptions: [subscriptionRow()] });

  try {
    const access = await resolveUserAccess("user-1");
    assert.equal(access.planCode, "consultoria-agronomica");
    assert.equal(access.entitlements.TECHNICAL_OPINIONS_MONTHLY, 3);
    assert.equal(access.entitlements.HUMAN_VALIDATION, true);
    assert.equal(access.subscription?.entitled, true);
  } finally {
    mock.restore();
  }
});

test("assinatura em atraso não libera o plano pago", async () => {
  const mock = mockBackend({
    subscriptions: [subscriptionRow({ status: "past_due", internal_status: "past_due" })]
  });

  try {
    const access = await resolveUserAccess("user-1");
    assert.equal(access.planCode, "gratuito");
    assert.equal(access.entitlements.TECHNICAL_OPINIONS_MONTHLY, 0);
  } finally {
    mock.restore();
  }
});

test("assinatura antiga e preservada e recebe os direitos equivalentes", async () => {
  const mock = mockBackend({
    subscriptions: [
      subscriptionRow({ id: "sub-legado", plan_id: LEGACY_PLAN_ROW.id, plans: LEGACY_PLAN_ROW })
    ]
  });

  try {
    const access = await resolveUserAccess("user-legado");
    // Direitos migrados para a Consultoria Agronômica...
    assert.equal(access.planCode, "consultoria-agronomica");
    assert.equal(access.entitlements.TECHNICAL_OPINIONS_MONTHLY, 3);
    // ...mas o plano cobrado continua sendo o antigo.
    assert.equal(access.legacyPlanCode, "ia-revisao-humana");
    assert.equal(access.planName, "IA + Revisao Humana");
    assert.equal(access.subscription?.priceCents, 39700);
  } finally {
    mock.restore();
  }
});

test("acesso ilimitado ignora os limites do plano", async () => {
  const mock = mockBackend({ profile: { status: "active", unlimited_access: true } });

  try {
    const access = await resolveUserAccess("user-admin");
    assert.equal(access.unlimitedAccess, true);
    assert.equal(access.entitlements.AI_MONTHLY_LIMIT, null);
    assert.equal(access.entitlements.HUMAN_VALIDATION, true);
  } finally {
    mock.restore();
  }
});

test("usuário inativo e sinalizado para bloqueio no servidor", async () => {
  const mock = mockBackend({ profile: { status: "inactive", unlimited_access: false } });

  try {
    const access = await resolveUserAccess("user-inativo");
    assert.equal(access.profileActive, false);
  } finally {
    mock.restore();
  }
});

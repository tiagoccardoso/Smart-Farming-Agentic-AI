/**
 * Limite de consultas a IA (itens 1, 18 e 19 do escopo):
 * primeira consulta, terceira consulta, bloqueio da quarta e mensagem explicativa.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanFeatureUnavailableError,
  UserInactiveError,
  assertPlanFeature,
  assertPlanLimit,
  getPlanLimitCheck
} from "../lib/billing/check-plan-limits";
import { CONSULTING_PLAN_ROW, FREE_PLAN_ROW, PROFESSIONAL_PLAN_ROW, subscriptionRow } from "./helpers/fixtures";
import { installFetchMock, setTestEnv } from "./helpers/http-mock";

setTestEnv();

type Options = {
  usedQuestions?: number;
  subscriptions?: unknown[];
  profile?: Record<string, unknown>;
};

function mockBackend(options: Options = {}) {
  const plans = [FREE_PLAN_ROW, PROFESSIONAL_PLAN_ROW, CONSULTING_PLAN_ROW];

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
    if (call.url.includes("/rest/v1/usage_events")) {
      if (call.method === "POST") {
        return { status: 201, body: null };
      }
      const used = options.usedQuestions ?? 0;
      return { body: used > 0 ? [{ count: used }] : [] };
    }
    return { body: [] };
  });
}

test("primeira consulta do plano Gratuito e permitida", async () => {
  const mock = mockBackend({ usedQuestions: 0 });

  try {
    const result = await getPlanLimitCheck("user-1", "ai_question");
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 3);
    assert.equal(result.remaining, 3);
  } finally {
    mock.restore();
  }
});

test("terceira consulta do plano Gratuito ainda e permitida", async () => {
  const mock = mockBackend({ usedQuestions: 2 });

  try {
    const result = await getPlanLimitCheck("user-1", "ai_question");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 1);
  } finally {
    mock.restore();
  }
});

test("quarta consulta e bloqueada com motivo explicito e CTA", async () => {
  const mock = mockBackend({ usedQuestions: 3 });

  try {
    const result = await getPlanLimitCheck("user-1", "ai_question");
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.match(result.message ?? "", /3 consultas/);
    assert.equal(result.cta?.href, "/planos");
    assert.match(result.cta?.label ?? "", /IA Profissional/);

    await assert.rejects(() => assertPlanLimit("user-1", "ai_question"), (error: unknown) => {
      assert.equal((error as { status: number }).status, 402);
      return true;
    });
  } finally {
    mock.restore();
  }
});

test("Consultoria Agronômica não esbarra no limite do Gratuito", async () => {
  const mock = mockBackend({ usedQuestions: 3, subscriptions: [subscriptionRow()] });

  try {
    const result = await getPlanLimitCheck("user-1", "ai_question");
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 300);
  } finally {
    mock.restore();
  }
});

test("relatórios ficam bloqueados no plano Gratuito", async () => {
  const mock = mockBackend();

  try {
    const result = await getPlanLimitCheck("user-1", "pdf_report");
    assert.equal(result.allowed, false);
    assert.match(result.message ?? "", /relatórios/i);
  } finally {
    mock.restore();
  }
});

test("análise de fotos exige plano pago e explica o motivo", async () => {
  const freeMock = mockBackend();

  try {
    await assert.rejects(() => assertPlanFeature("user-1", "photo_upload"), (error: unknown) => {
      assert.ok(error instanceof PlanFeatureUnavailableError);
      assert.match((error as Error).message, /análise e interpretacao de fotos/);
      return true;
    });
  } finally {
    freeMock.restore();
  }

  const paidMock = mockBackend({
    subscriptions: [subscriptionRow({ plan_id: PROFESSIONAL_PLAN_ROW.id, plans: PROFESSIONAL_PLAN_ROW })]
  });

  try {
    const result = await assertPlanFeature("user-1", "photo_upload");
    assert.equal(result.planSlug, "ia-profissional");
  } finally {
    paidMock.restore();
  }
});

test("usuário inativo e bloqueado antes de qualquer consumo", async () => {
  const mock = mockBackend({ profile: { status: "inactive", unlimited_access: false } });

  try {
    await assert.rejects(() => getPlanLimitCheck("user-1", "ai_question"), UserInactiveError);
  } finally {
    mock.restore();
  }
});

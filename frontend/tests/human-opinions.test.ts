/**
 * Parecer agronômico humano como benefício mensal do plano.
 *
 *   IA Profissional ........ 1 parecer por ciclo (bloqueia o 2º)
 *   Consultoria Agronômica . 3 pareceres por ciclo (bloqueia o 4º)
 *   Demais planos .......... sem acesso
 *
 * A atomicidade/concorrência é garantida no Postgres (request_case_human_opinion)
 * e foi verificada em banco real; aqui validamos a regra, o saldo, o ciclo e o
 * contrato com a função.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveUserAccess } from "../lib/billing/entitlements";
import {
  HumanOpinionUnavailableError,
  getHumanOpinionStatus,
  normalizeIdempotencyKey,
  requestHumanOpinionForCase
} from "../lib/billing/human-opinions";
import { CONSULTING_PLAN_ROW, FREE_PLAN_ROW, PROFESSIONAL_PLAN_ROW, subscriptionRow } from "./helpers/fixtures";
import { installFetchMock, setTestEnv } from "./helpers/http-mock";

setTestEnv();

type Options = {
  subscriptions?: unknown[];
  used?: number;
  profile?: { status: string; unlimited_access: boolean };
  existingKey?: { id: string; case_id: string } | null;
  rpcError?: string;
  rpcReplayed?: boolean;
};

const PRO_SUB = () => subscriptionRow({ plan_id: PROFESSIONAL_PLAN_ROW.id, plans: PROFESSIONAL_PLAN_ROW });
const CONSULTING_SUB = () => subscriptionRow();

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
    if (call.url.includes("/rest/v1/rpc/request_case_human_opinion")) {
      if (options.rpcError) {
        return { status: 400, body: { message: options.rpcError } };
      }
      return {
        body: {
          opinion: { id: "opinion-novo", case_id: "case-1", status: "aberto", origin: "subscription" },
          replayed: Boolean(options.rpcReplayed)
        }
      };
    }
    if (call.url.includes("/rest/v1/technical_opinions") && call.url.includes("idempotency_key=eq.")) {
      return { body: options.existingKey ? [options.existingKey] : [] };
    }
    if (call.url.includes("/rest/v1/technical_opinions")) {
      return { body: Array.from({ length: options.used ?? 0 }, (_, index) => ({ id: `op-${index}` })) };
    }
    return { body: [] };
  });
}

async function statusFor(options: Options) {
  const mock = mockBackend(options);
  try {
    const access = await resolveUserAccess("user-1");
    return { status: await getHumanOpinionStatus(access), mock };
  } finally {
    mock.restore();
  }
}

// ---------------------------------------------------------------------------
// Sem direito
// ---------------------------------------------------------------------------

test("usuário sem assinatura (Gratuito) não tem acesso ao parecer humano", async () => {
  const { status, mock } = await statusFor({});
  assert.equal(status.eligible, false);
  assert.equal(status.reason, "plan_without_benefit");
  assert.match(status.message, /IA Profissional e PlantaSa Consultoria Agronômica/);
  // Nem chega a contar consumo.
  assert.equal(mock.callsTo("/rest/v1/technical_opinions").length, 0);
});

test("assinatura em atraso, cancelada ou expirada não libera o parecer", async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const subscription of [
    subscriptionRow({ status: "past_due", internal_status: "past_due" }),
    subscriptionRow({ status: "canceled", internal_status: "canceled" }),
    subscriptionRow({ status: "incomplete", internal_status: "incomplete" }),
    subscriptionRow({ status: "active", internal_status: "active", current_period_end: past })
  ]) {
    const { status } = await statusFor({ subscriptions: [subscription] });
    assert.equal(status.eligible, false);
    assert.equal(status.reason, "plan_without_benefit");
  }
});

test("usuário inativo é bloqueado com 403", async () => {
  const mock = mockBackend({ subscriptions: [CONSULTING_SUB()], profile: { status: "inactive", unlimited_access: false } });
  try {
    const access = await resolveUserAccess("user-1");
    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-1", idempotencyKey: "chave-123456", title: "Soja", description: "Manchas nas folhas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 403
    );
    assert.equal(mock.callsTo("rpc/request_case_human_opinion").length, 0);
  } finally {
    mock.restore();
  }
});

test("plano sem benefício: API bloqueia antes de chamar o banco (402)", async () => {
  const mock = mockBackend({});
  try {
    const access = await resolveUserAccess("user-1");
    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-1", idempotencyKey: "chave-123456", title: "Soja", description: "Manchas nas folhas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 402 && error.reason === "plan_without_benefit"
    );
    assert.equal(mock.callsTo("rpc/request_case_human_opinion").length, 0);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// IA Profissional: 1 por ciclo
// ---------------------------------------------------------------------------

test("IA Profissional: início do ciclo mostra 1 de 1", async () => {
  const { status } = await statusFor({ subscriptions: [PRO_SUB()], used: 0 });
  assert.equal(status.eligible, true);
  assert.equal(status.limit, 1);
  assert.equal(status.remaining, 1);
  assert.equal(status.balanceLabel, "Pareceres disponíveis neste mês: 1 de 1");
});

test("IA Profissional: primeiro envio chama a função atômica com limite 1 e o ciclo da assinatura", async () => {
  const subscription = PRO_SUB();
  const mock = mockBackend({ subscriptions: [subscription], used: 0 });
  try {
    const access = await resolveUserAccess("user-1");
    const result = await requestHumanOpinionForCase({
      access,
      caseId: "case-1",
      idempotencyKey: "chave-123456",
      title: "Soja — parecer agronômico",
      description: "Manchas nas folhas"
    });
    assert.equal(result.replayed, false);

    const rpc = mock.callsTo("rpc/request_case_human_opinion");
    assert.equal(rpc.length, 1);
    const body = rpc[0].body as Record<string, unknown>;
    assert.equal(body.p_monthly_limit, 1);
    assert.equal(body.p_plan_code, "ia-profissional");
    assert.equal(body.p_subscription_id, "sub-1");
    assert.equal(body.p_cycle_start, new Date(subscription.current_period_start).toISOString());
    assert.equal(body.p_cycle_end, new Date(subscription.current_period_end).toISOString());
    assert.equal(body.p_idempotency_key, "chave-123456");
  } finally {
    mock.restore();
  }
});

test("IA Profissional: após o envio, 0 de 1 e o segundo é bloqueado com data de renovação", async () => {
  const subscription = PRO_SUB();
  const mock = mockBackend({ subscriptions: [subscription], used: 1 });
  try {
    const access = await resolveUserAccess("user-1");
    const status = await getHumanOpinionStatus(access);
    assert.equal(status.eligible, false);
    assert.equal(status.reason, "limit_reached");
    assert.equal(status.balanceLabel, "Pareceres disponíveis neste mês: 0 de 1");
    assert.match(status.message, /Você já utilizou o seu parecer disponível neste ciclo\./);
    assert.match(status.message, /Seu benefício será renovado em \d{2}\/\d{2}\/\d{4}\./);
    assert.equal(status.renewsAt, new Date(subscription.current_period_end).toISOString());

    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-2", idempotencyKey: "chave-999999", title: "Milho", description: "Folhas amarelas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 402 && error.reason === "limit_reached"
    );
    assert.equal(mock.callsTo("rpc/request_case_human_opinion").length, 0);
  } finally {
    mock.restore();
  }
});

test("novo ciclo: a contagem usa a janela do novo período da assinatura", async () => {
  const start = new Date(Date.now() - 60 * 1000).toISOString();
  const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const mock = mockBackend({
    subscriptions: [subscriptionRow({ plan_id: PROFESSIONAL_PLAN_ROW.id, plans: PROFESSIONAL_PLAN_ROW, current_period_start: start, current_period_end: end })],
    used: 0
  });
  try {
    const access = await resolveUserAccess("user-1");
    const status = await getHumanOpinionStatus(access);
    assert.equal(status.balanceLabel, "Pareceres disponíveis neste mês: 1 de 1");
    const countCall = mock.callsTo("/rest/v1/technical_opinions")[0];
    assert.ok(countCall.url.includes(`created_at=gte.${encodeURIComponent(new Date(start).toISOString())}`));
    assert.ok(countCall.url.includes(`created_at=lt.${encodeURIComponent(new Date(end).toISOString())}`));
    assert.ok(countCall.url.includes("status=neq.cancelado"));
    assert.ok(countCall.url.includes("origin=eq.subscription"));
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// Consultoria Agronômica: 3 por ciclo
// ---------------------------------------------------------------------------

test("Consultoria Agronômica: 3 de 3, 2 de 3, 1 de 3 e 0 de 3 (4º bloqueado)", async () => {
  const expectations: Array<[number, string, boolean]> = [
    [0, "Pareceres disponíveis neste mês: 3 de 3", true],
    [1, "Pareceres disponíveis neste mês: 2 de 3", true],
    [2, "Pareceres disponíveis neste mês: 1 de 3", true],
    [3, "Pareceres disponíveis neste mês: 0 de 3", false]
  ];
  for (const [used, label, eligible] of expectations) {
    const { status } = await statusFor({ subscriptions: [CONSULTING_SUB()], used });
    assert.equal(status.balanceLabel, label);
    assert.equal(status.eligible, eligible);
  }
  const { status } = await statusFor({ subscriptions: [CONSULTING_SUB()], used: 3 });
  assert.match(status.message, /Você já utilizou os 3 pareceres disponíveis neste ciclo\./);
});

test("Consultoria Agronômica: envio passa limite 3 para a função", async () => {
  const mock = mockBackend({ subscriptions: [CONSULTING_SUB()], used: 2 });
  try {
    const access = await resolveUserAccess("user-1");
    await requestHumanOpinionForCase({ access, caseId: "case-3", idempotencyKey: "chave-333333", title: "Café", description: "Ferrugem nas folhas" });
    const body = mock.callsTo("rpc/request_case_human_opinion")[0].body as Record<string, unknown>;
    assert.equal(body.p_monthly_limit, 3);
    assert.equal(body.p_plan_code, "consultoria-agronomica");
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// Upgrade, downgrade e cancelamento
// ---------------------------------------------------------------------------

test("upgrade no meio do ciclo: usou 1 no IA Profissional e passa a ter 2 restantes (sem franquia duplicada)", async () => {
  // Mesmo período (o Stripe mantém o billing_cycle_anchor), novo plano.
  const { status } = await statusFor({ subscriptions: [CONSULTING_SUB()], used: 1 });
  assert.equal(status.limit, 3);
  assert.equal(status.remaining, 2);
});

test("downgrade: com 3 usados no ciclo, IA Profissional fica 0 de 1 e bloqueado", async () => {
  const { status } = await statusFor({ subscriptions: [PRO_SUB()], used: 3 });
  assert.equal(status.remaining, 0);
  assert.equal(status.eligible, false);
  assert.equal(status.balanceLabel, "Pareceres disponíveis neste mês: 0 de 1");
});

test("cancelamento agendado mantém o benefício até o fim do período e não promete renovação", async () => {
  const subscription = subscriptionRow({
    plan_id: PROFESSIONAL_PLAN_ROW.id,
    plans: PROFESSIONAL_PLAN_ROW,
    internal_status: "scheduled_cancellation",
    cancel_at_period_end: true
  });
  const available = await statusFor({ subscriptions: [subscription], used: 0 });
  assert.equal(available.status.eligible, true);
  assert.equal(available.status.renewsAt, null);
  assert.equal(available.status.benefitEndsAt, new Date(subscription.current_period_end).toISOString());

  const exhausted = await statusFor({ subscriptions: [subscription], used: 1 });
  assert.equal(exhausted.status.eligible, false);
  assert.match(exhausted.status.message, /cancelamento agendado/);
  assert.doesNotMatch(exhausted.status.message, /benefício será renovado em/);
});

// ---------------------------------------------------------------------------
// Idempotência, concorrência e segurança
// ---------------------------------------------------------------------------

test("reenvio com a mesma chave devolve o registro existente sem novo consumo", async () => {
  const mock = mockBackend({ subscriptions: [PRO_SUB()], used: 1, existingKey: { id: "opinion-antigo", case_id: "case-1" } });
  try {
    const access = await resolveUserAccess("user-1");
    // Mesmo com saldo 0 (o próprio envio consumiu), o retry é aceito como replay.
    const result = await requestHumanOpinionForCase({ access, caseId: "case-1", idempotencyKey: "chave-123456", title: "Soja", description: "Manchas" });
    assert.equal(result.replayed, true);
    assert.equal(result.opinion.id, "opinion-antigo");
    assert.equal(mock.callsTo("rpc/request_case_human_opinion").length, 0);
  } finally {
    mock.restore();
  }
});

test("corrida: o banco recusa o excedente e a API responde limite atingido", async () => {
  const mock = mockBackend({ subscriptions: [CONSULTING_SUB()], used: 2, rpcError: "HUMAN_OPINION_LIMIT_REACHED" });
  try {
    const access = await resolveUserAccess("user-1");
    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-4", idempotencyKey: "chave-444444", title: "Soja", description: "Manchas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 402 && error.reason === "limit_reached"
    );
  } finally {
    mock.restore();
  }
});

test("caso de outro usuário é recusado pelo banco (404) sem consumo", async () => {
  const mock = mockBackend({ subscriptions: [CONSULTING_SUB()], used: 0, rpcError: "CASE_NOT_FOUND" });
  try {
    const access = await resolveUserAccess("user-1");
    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-de-outro", idempotencyKey: "chave-555555", title: "Soja", description: "Manchas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 404
    );
  } finally {
    mock.restore();
  }
});

test("caso já enviado não consome novo parecer (409)", async () => {
  const mock = mockBackend({ subscriptions: [CONSULTING_SUB()], used: 0, rpcError: "CASE_ALREADY_IN_REVIEW" });
  try {
    const access = await resolveUserAccess("user-1");
    await assert.rejects(
      () => requestHumanOpinionForCase({ access, caseId: "case-1", idempotencyKey: null, title: "Soja", description: "Manchas" }),
      (error: unknown) => error instanceof HumanOpinionUnavailableError && error.status === 409
    );
  } finally {
    mock.restore();
  }
});

test("limite vem só do banco: nenhum campo de plano/limite é aceito como entrada", async () => {
  const mock = mockBackend({ subscriptions: [PRO_SUB()], used: 0 });
  try {
    const access = await resolveUserAccess("user-1");
    // Simula um cliente que tenta forçar limite/plano extra no payload.
    const tampered = { access, caseId: "case-1", idempotencyKey: "chave-777777", title: "Soja", description: "Manchas", limit: 99, plan: "consultoria-agronomica" } as unknown as Parameters<typeof requestHumanOpinionForCase>[0];
    await requestHumanOpinionForCase(tampered);
    const body = mock.callsTo("rpc/request_case_human_opinion")[0].body as Record<string, unknown>;
    assert.equal(body.p_monthly_limit, 1);
    assert.equal(body.p_plan_code, "ia-profissional");
  } finally {
    mock.restore();
  }
});

test("chave de idempotência aceita apenas formato opaco seguro", () => {
  assert.equal(normalizeIdempotencyKey("6f1c0e8e-3b7a-4c1e-9f2d-1a2b3c4d5e6f"), "6f1c0e8e-3b7a-4c1e-9f2d-1a2b3c4d5e6f");
  assert.equal(normalizeIdempotencyKey("curta"), null);
  assert.equal(normalizeIdempotencyKey("x'; drop table plans;--"), null);
  assert.equal(normalizeIdempotencyKey(123), null);
  assert.equal(normalizeIdempotencyKey("a".repeat(121)), null);
});

test("acesso ilimitado (equipe) pode enviar sem limite mensal", async () => {
  const mock = mockBackend({ profile: { status: "active", unlimited_access: true }, used: 5 });
  try {
    const access = await resolveUserAccess("user-admin");
    const status = await getHumanOpinionStatus(access);
    assert.equal(status.eligible, true);
    assert.equal(status.limit, null);
    await requestHumanOpinionForCase({ access, caseId: "case-1", idempotencyKey: "chave-888888", title: "Soja", description: "Manchas" });
    const body = mock.callsTo("rpc/request_case_human_opinion")[0].body as Record<string, unknown>;
    assert.equal(body.p_monthly_limit, 1_000_000);
  } finally {
    mock.restore();
  }
});

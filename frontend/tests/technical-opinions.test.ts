/**
 * Regra dos pareceres tecnicos (item 4 do escopo) e parecer avulso (item 6):
 * primeiro parecer, terceiro parecer, bloqueio do quarto, liberacao por credito
 * avulso e mensagens que nao consomem pareceres.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveUserAccess } from "../lib/billing/entitlements";
import {
  TechnicalOpinionLimitError,
  addTechnicalOpinionMessage,
  createTechnicalOpinion,
  getTechnicalOpinionBalance,
  grantTechnicalOpinionCredit
} from "../lib/billing/technical-opinions";
import { CONSULTING_PLAN_ROW, FREE_PLAN_ROW, PROFESSIONAL_PLAN_ROW, subscriptionRow } from "./helpers/fixtures";
import { installFetchMock, setTestEnv } from "./helpers/http-mock";

setTestEnv();

type Options = {
  openedInCycle?: number;
  credits?: number;
  subscriptions?: unknown[];
  existingCreditForSession?: boolean;
  duplicateCredit?: boolean;
};

function mockBackend(options: Options = {}) {
  const plans = [FREE_PLAN_ROW, PROFESSIONAL_PLAN_ROW, CONSULTING_PLAN_ROW];

  return installFetchMock((call) => {
    if (call.url.includes("/rest/v1/profiles")) {
      return { body: [{ status: "active", unlimited_access: false }] };
    }
    if (call.url.includes("/rest/v1/subscriptions")) {
      return { body: options.subscriptions ?? [subscriptionRow()] };
    }
    if (call.url.includes("/rest/v1/plans")) {
      const match = /slug=eq\.([^&]+)/.exec(call.url);
      const slug = match ? decodeURIComponent(match[1]) : null;
      return { body: plans.filter((plan) => !slug || plan.slug === slug) };
    }
    if (call.url.includes("/rest/v1/technical_opinion_credits")) {
      if (call.method === "POST") {
        if (options.duplicateCredit) {
          return { status: 409, body: { message: "duplicate key value violates unique constraint" } };
        }
        return { status: 201, body: [{ id: "credit-novo" }] };
      }
      if (call.url.includes("stripe_checkout_session_id=eq.")) {
        return { body: options.existingCreditForSession ? [{ id: "credit-existente" }] : [] };
      }
      return { body: Array.from({ length: options.credits ?? 0 }, (_, index) => ({ id: `credit-${index}` })) };
    }
    if (call.url.includes("/rest/v1/rpc/create_technical_opinion")) {
      return {
        body: {
          id: "opinion-1",
          user_id: "user-1",
          origin: "subscription",
          title: "Mancha nas folhas",
          description: "Descricao suficiente do problema",
          status: "aberto",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      };
    }
    if (call.url.includes("/rest/v1/technical_opinion_messages")) {
      return { status: 201, body: [{ id: "msg-1", opinion_id: "opinion-1", body: "Segue foto", attachments: [] }] };
    }
    if (call.url.includes("/rest/v1/technical_opinions")) {
      return { body: Array.from({ length: options.openedInCycle ?? 0 }, (_, index) => ({ id: `op-${index}` })) };
    }
    return { body: [] };
  });
}

test("primeiro parecer do ciclo pode ser aberto", async () => {
  const mock = mockBackend({ openedInCycle: 0 });

  try {
    const access = await resolveUserAccess("user-1");
    const balance = await getTechnicalOpinionBalance(access);
    assert.equal(balance.limit, 3);
    assert.equal(balance.used, 0);
    assert.equal(balance.canOpen, true);

    const opinion = await createTechnicalOpinion({
      access,
      title: "Mancha nas folhas",
      description: "Descricao suficiente do problema"
    });
    assert.equal(opinion.id, "opinion-1");
    assert.equal(mock.callsTo("rpc/create_technical_opinion").length, 1);
  } finally {
    mock.restore();
  }
});

test("terceiro parecer ainda e permitido e a mensagem de uso e exibida", async () => {
  const mock = mockBackend({ openedInCycle: 2 });

  try {
    const access = await resolveUserAccess("user-1");
    const balance = await getTechnicalOpinionBalance(access);
    assert.equal(balance.usageLabel, "Pareceres utilizados neste ciclo: 2 de 3");
    assert.equal(balance.remainingLabel, "Voce possui 1 parecer disponivel neste ciclo.");
    assert.equal(balance.canOpen, true);
  } finally {
    mock.restore();
  }
});

test("quarto parecer e bloqueado quando nao ha credito avulso", async () => {
  const mock = mockBackend({ openedInCycle: 3, credits: 0 });

  try {
    const access = await resolveUserAccess("user-1");
    const balance = await getTechnicalOpinionBalance(access);
    assert.equal(balance.remaining, 0);
    assert.equal(balance.canOpen, false);
    assert.equal(balance.usageLabel, "Pareceres utilizados neste ciclo: 3 de 3");

    await assert.rejects(
      () =>
        createTechnicalOpinion({
          access,
          title: "Quarta demanda",
          description: "Descricao suficiente do problema"
        }),
      (error: unknown) => {
        assert.ok(error instanceof TechnicalOpinionLimitError);
        assert.match((error as Error).message, /3 pareceres tecnicos disponiveis neste ciclo/);
        return true;
      }
    );

    assert.equal(mock.callsTo("rpc/create_technical_opinion").length, 0);
  } finally {
    mock.restore();
  }
});

test("credito avulso pago libera uma demanda alem da franquia", async () => {
  const mock = mockBackend({ openedInCycle: 3, credits: 1 });

  try {
    const access = await resolveUserAccess("user-1");
    const balance = await getTechnicalOpinionBalance(access);
    assert.equal(balance.remaining, 0);
    assert.equal(balance.availableCredits, 1);
    assert.equal(balance.canOpen, true);

    await createTechnicalOpinion({ access, title: "Demanda avulsa", description: "Descricao suficiente" });
    assert.equal(mock.callsTo("rpc/create_technical_opinion").length, 1);
  } finally {
    mock.restore();
  }
});

test("plano sem pareceres bloqueia a abertura com mensagem propria", async () => {
  const mock = mockBackend({
    subscriptions: [subscriptionRow({ plan_id: PROFESSIONAL_PLAN_ROW.id, plans: PROFESSIONAL_PLAN_ROW })],
    credits: 0
  });

  try {
    const access = await resolveUserAccess("user-1");
    const balance = await getTechnicalOpinionBalance(access);
    assert.equal(balance.limit, 0);
    assert.equal(balance.canOpen, false);

    await assert.rejects(
      () => createTechnicalOpinion({ access, title: "Demanda", description: "Descricao suficiente" }),
      (error: unknown) => {
        assert.match((error as Error).message, /nao inclui pareceres tecnicos/);
        return true;
      }
    );
  } finally {
    mock.restore();
  }
});

test("mensagens da mesma demanda nao consomem pareceres", async () => {
  const mock = mockBackend({ openedInCycle: 3, credits: 0 });

  try {
    await addTechnicalOpinionMessage({
      opinionId: "opinion-1",
      authorId: "user-1",
      authorRole: "client",
      body: "Segue foto complementar",
      attachments: ["https://exemplo/foto.jpg"]
    });

    assert.equal(mock.callsTo("rpc/create_technical_opinion").length, 0);
    assert.equal(mock.callsTo("technical_opinion_credits").length, 0);
    assert.equal(mock.callsTo("technical_opinion_messages").length, 1);
  } finally {
    mock.restore();
  }
});

test("pagamento avulso confirmado libera exatamente 1 credito", async () => {
  const mock = mockBackend();

  try {
    const result = await grantTechnicalOpinionCredit({
      userId: "user-1",
      oneTimeOrderId: "order-1",
      stripeCheckoutSessionId: "cs_test_1",
      amountCents: 19700
    });

    assert.equal(result.granted, true);
    assert.equal(mock.callsTo("technical_opinion_credits").filter((call) => call.method === "POST").length, 1);
  } finally {
    mock.restore();
  }
});

test("webhook duplicado nao libera um segundo parecer avulso", async () => {
  const mock = mockBackend({ existingCreditForSession: true });

  try {
    const result = await grantTechnicalOpinionCredit({
      userId: "user-1",
      oneTimeOrderId: "order-1",
      stripeCheckoutSessionId: "cs_test_1"
    });

    assert.equal(result.granted, false);
    assert.equal(result.reason, "already_granted");
    assert.equal(mock.callsTo("technical_opinion_credits").filter((call) => call.method === "POST").length, 0);
  } finally {
    mock.restore();
  }
});

test("corrida no banco (indice unico) tambem e tratada como idempotente", async () => {
  const mock = mockBackend({ duplicateCredit: true });

  try {
    const result = await grantTechnicalOpinionCredit({
      userId: "user-1",
      stripeCheckoutSessionId: "cs_test_2"
    });

    assert.equal(result.granted, false);
    assert.equal(result.reason, "already_granted");
  } finally {
    mock.restore();
  }
});

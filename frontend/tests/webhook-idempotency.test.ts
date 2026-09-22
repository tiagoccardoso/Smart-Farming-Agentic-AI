/**
 * Idempotência dos webhooks (item 10 do escopo): o mesmo event.id nunca e
 * processado duas vezes, e um evento que falhou pode ser reprocessado.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { claimStripeEvent, markStripeEventProcessed } from "../lib/stripe/webhook-events";
import { installFetchMock, setTestEnv } from "./helpers/http-mock";

setTestEnv();

function mockEvents(existing: { status: string } | null, conflictOnInsert = false) {
  return installFetchMock((call) => {
    if (call.url.includes("/rest/v1/stripe_webhook_events")) {
      if (call.method === "GET") {
        return { body: existing ? [{ event_id: "evt_1", status: existing.status }] : [] };
      }
      if (call.method === "POST") {
        return conflictOnInsert
          ? { status: 409, body: { message: "duplicate key value violates unique constraint" } }
          : { status: 201, body: null };
      }
      return { status: 204, body: null };
    }
    return { body: [] };
  });
}

test("evento novo e reservado para processamento", async () => {
  const mock = mockEvents(null);

  try {
    const claim = await claimStripeEvent("evt_1", "checkout.session.completed");
    assert.equal(claim.claimed, true);
  } finally {
    mock.restore();
  }
});

test("evento já processado e descartado", async () => {
  const mock = mockEvents({ status: "processed" });

  try {
    const claim = await claimStripeEvent("evt_1", "checkout.session.completed");
    assert.equal(claim.claimed, false);
  } finally {
    mock.restore();
  }
});

test("evento que falhou pode ser reprocessado na retentativa do Stripe", async () => {
  const mock = mockEvents({ status: "failed" });

  try {
    const claim = await claimStripeEvent("evt_1", "invoice.payment_failed");
    assert.equal(claim.claimed, true);
  } finally {
    mock.restore();
  }
});

test("entrega simultanea do mesmo evento: apenas uma processa", async () => {
  const mock = mockEvents(null, true);

  try {
    const claim = await claimStripeEvent("evt_1", "customer.subscription.updated");
    assert.equal(claim.claimed, false);
  } finally {
    mock.restore();
  }
});

test("entrega concorrente enquanto o evento ainda está em processamento não reprocessa", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.includes("/rest/v1/stripe_webhook_events") && call.method === "GET") {
      return { body: [{ event_id: "evt_1", status: "processing", received_at: new Date().toISOString() }] };
    }
    return { status: 204, body: null };
  });

  try {
    const claim = await claimStripeEvent("evt_1", "customer.subscription.updated");
    assert.deepEqual(claim, { claimed: false, reason: "in_progress" });
    assert.equal(mock.calls.filter((call) => call.method === "PATCH").length, 0);
  } finally {
    mock.restore();
  }
});

test("evento preso em processamento há mais de 2 minutos pode ser retomado", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.includes("/rest/v1/stripe_webhook_events") && call.method === "GET") {
      return { body: [{ event_id: "evt_1", status: "processing", received_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }] };
    }
    return { status: 204, body: null };
  });

  try {
    const claim = await claimStripeEvent("evt_1", "customer.subscription.updated");
    assert.equal(claim.claimed, true);
  } finally {
    mock.restore();
  }
});

test("marcar como processado registra o resultado", async () => {
  const mock = mockEvents({ status: "processing" });

  try {
    await markStripeEventProcessed("evt_1", { updated: true });
    const patches = mock.callsTo("stripe_webhook_events").filter((call) => call.method === "PATCH");
    assert.ok(patches.length >= 1);
    assert.equal((patches.at(-1)?.body as { status: string }).status, "processed");
  } finally {
    mock.restore();
  }
});

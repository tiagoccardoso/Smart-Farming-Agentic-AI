/**
 * Estados da assinatura (item 11 do escopo).
 * Garante que a aplicacao não libera plano so porque existe subscription_id.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isSubscriptionEntitled,
  mapStripeSubscriptionStatus
} from "../lib/billing/subscription-state";

test("assinatura ativa da direito aos recursos", () => {
  const state = mapStripeSubscriptionStatus("active", false);
  assert.equal(state, "active");
  assert.equal(isSubscriptionEntitled(state, null), true);
});

test("período de teste da direito aos recursos", () => {
  assert.equal(mapStripeSubscriptionStatus("trialing", false), "trialing");
  assert.equal(isSubscriptionEntitled("trialing", null), true);
});

test("cancelamento agendado mantem o acesso até o fim do período pago", () => {
  const state = mapStripeSubscriptionStatus("active", true);
  assert.equal(state, "scheduled_cancellation");
  assert.equal(isSubscriptionEntitled(state, new Date(Date.now() + 86_400_000).toISOString()), true);
});

test("pagamento em atraso não libera recursos", () => {
  const state = mapStripeSubscriptionStatus("past_due", false);
  assert.equal(state, "past_due");
  assert.equal(isSubscriptionEntitled(state, null), false);
});

test("assinatura incompleta não libera recursos", () => {
  assert.equal(mapStripeSubscriptionStatus("incomplete", false), "incomplete");
  assert.equal(isSubscriptionEntitled("incomplete", null), false);
});

test("assinatura cancelada e encerrada não liberam recursos", () => {
  assert.equal(mapStripeSubscriptionStatus("canceled", false), "canceled");
  assert.equal(mapStripeSubscriptionStatus("unpaid", false), "ended");
  assert.equal(mapStripeSubscriptionStatus("incomplete_expired", false), "ended");
  assert.equal(isSubscriptionEntitled("canceled", null), false);
  assert.equal(isSubscriptionEntitled("ended", null), false);
});

test("checkout pendente e tratado como pagamento pendente", () => {
  const state = mapStripeSubscriptionStatus("checkout_pending", false);
  assert.equal(state, "payment_pending");
  assert.equal(isSubscriptionEntitled(state, null), false);
});

test("status desconhecido nunca libera recursos", () => {
  assert.equal(isSubscriptionEntitled(mapStripeSubscriptionStatus("qualquer_coisa"), null), false);
});

test("período expirado encerra o direito mesmo com status ativo", () => {
  const expired = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(isSubscriptionEntitled("active", expired), false);
});

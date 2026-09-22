/**
 * Validação da assinatura do webhook (item 10 do escopo).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyStripeSignature } from "../lib/stripe/signature";

const SECRET = "whsec_teste";

function sign(payload: string, timestamp: number, secret = SECRET) {
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("assinatura valida e aceita", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature(payload, sign(payload, now), SECRET, now), true);
});

test("payload adulterado e rejeitado", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const now = Math.floor(Date.now() / 1000);
  const header = sign(payload, now);
  assert.equal(verifyStripeSignature(JSON.stringify({ id: "evt_2" }), header, SECRET, now), false);
});

test("segredo errado e rejeitado", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature(payload, sign(payload, now, "outro"), SECRET, now), false);
});

test("assinatura antiga e rejeitada (protecao contra replay)", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(verifyStripeSignature(payload, sign(payload, old), SECRET, Math.floor(Date.now() / 1000)), false);
});

test("cabecalho sem v1 e rejeitado", () => {
  const payload = JSON.stringify({ id: "evt_1" });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyStripeSignature(payload, `t=${now}`, SECRET, now), false);
});

/**
 * Ciclos de cobrança: reinicio automático dos contadores (itens 1 e 4).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getCalendarMonthCycle, resolveSubscriptionCycle } from "../lib/billing/billing-cycle";
import type { ResolvedSubscription } from "../lib/billing/entitlements";

test("ciclo de calendario cobre o mês inteiro e reinicia no mês seguinte", () => {
  const cycle = getCalendarMonthCycle(new Date("2026-09-22T12:00:00Z"));
  assert.equal(cycle.reference, "cal:2026-09");
  assert.equal(cycle.start, "2026-09-01T00:00:00.000Z");
  assert.equal(cycle.end, "2026-10-01T00:00:00.000Z");

  const next = getCalendarMonthCycle(new Date("2026-10-01T00:00:00Z"));
  assert.notEqual(next.reference, cycle.reference);
});

test("assinatura ativa usa o próprio ciclo de cobrança", () => {
  const subscription = {
    id: "sub-1",
    entitled: true,
    currentPeriodStart: "2026-09-10T00:00:00.000Z",
    currentPeriodEnd: "2026-10-10T00:00:00.000Z"
  } as ResolvedSubscription;

  const cycle = resolveSubscriptionCycle(subscription);
  assert.equal(cycle.source, "subscription");
  assert.equal(cycle.reference, "sub:sub-1:2026-09-10T00:00:00.000Z");
});

test("assinatura sem direito cai para o ciclo de calendario", () => {
  const subscription = {
    id: "sub-1",
    entitled: false,
    currentPeriodStart: "2026-09-10T00:00:00.000Z",
    currentPeriodEnd: "2026-10-10T00:00:00.000Z"
  } as ResolvedSubscription;

  assert.equal(resolveSubscriptionCycle(subscription, new Date("2026-09-22T00:00:00Z")).source, "calendar");
});

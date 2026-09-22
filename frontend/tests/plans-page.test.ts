/**
 * Apresentacao de precos na pagina publica (item 7): nunca criar preco ficticio.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatPlanPrice, isQuotePlan, type PlanPagePlan } from "../lib/plans-page";

function plan(overrides: Partial<PlanPagePlan>): PlanPagePlan {
  return {
    id: "p",
    name: "Plano",
    slug: "plano",
    eyebrow: "",
    audience: "",
    description: "",
    price_cents: 0,
    billing_type: "monthly",
    plan_kind: "subscription",
    price_prefix: "",
    price_period: "",
    price_note: "",
    features: [],
    exclusions: [],
    button_label: "Assinar",
    highlighted: false,
    badge: null,
    active: true,
    display_order: 0,
    ...overrides
  };
}

test("plano mensal exibe o preco formatado em BRL", () => {
  const formatted = formatPlanPrice(plan({ price_cents: 9700, price_period: "mes" }));
  assert.ok(formatted.includes("97,00"));
  assert.ok(formatted.endsWith("/mes"));
});

test("Presencial & Projetos Especiais exibe 'Sob consulta', nunca um preco", () => {
  const quote = plan({ slug: "presencial-projetos", plan_kind: "quote", billing_type: "quote", price_note: "Sob consulta" });
  assert.equal(isQuotePlan(quote), true);
  assert.equal(formatPlanPrice(quote), "Sob consulta");
});

test("plano sob consulta sem texto configurado ainda assim nao mostra R$ 0,00", () => {
  const quote = plan({ slug: "presencial-projetos", plan_kind: "quote", price_note: "" });
  assert.equal(formatPlanPrice(quote), "Sob consulta");
});

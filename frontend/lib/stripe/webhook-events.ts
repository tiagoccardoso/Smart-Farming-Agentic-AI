/**
 * Idempotencia dos webhooks do Stripe.
 *
 * O Stripe reenvia o mesmo evento em caso de falha ou timeout. Registramos
 * `event.id` antes de processar: um evento ja processado e descartado, e um
 * evento que falhou pode ser reprocessado na retentativa do Stripe.
 */

import { supabaseAdminRequest } from "../server/supabaseAdmin";

export type WebhookEventRow = {
  event_id: string;
  event_type: string;
  status: "processing" | "processed" | "failed" | "ignored";
  received_at?: string | null;
  processed_at?: string | null;
};

export type ClaimResult = { claimed: true } | { claimed: false; reason: "already_processed" };

export async function claimStripeEvent(eventId: string, eventType: string): Promise<ClaimResult> {
  const existing = await supabaseAdminRequest<WebhookEventRow[]>(
    `/rest/v1/stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id,status&limit=1`,
    { method: "GET" }
  );

  if (existing[0]) {
    if (existing[0].status === "processed" || existing[0].status === "ignored") {
      return { claimed: false, reason: "already_processed" };
    }

    // Evento anterior falhou ou ficou preso: liberamos o reprocessamento.
    await supabaseAdminRequest(`/rest/v1/stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "processing", error_message: null })
    });

    return { claimed: true };
  }

  try {
    await supabaseAdminRequest("/rest/v1/stripe_webhook_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ event_id: eventId, event_type: eventType, status: "processing" })
    });

    return { claimed: true };
  } catch (error) {
    // Corrida entre duas entregas do mesmo evento: a segunda perde.
    if (error instanceof Error && /duplicate key|unique constraint/i.test(error.message)) {
      return { claimed: false, reason: "already_processed" };
    }
    throw error;
  }
}

export async function markStripeEventProcessed(eventId: string, result: unknown, ignored = false) {
  await supabaseAdminRequest(`/rest/v1/stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: ignored ? "ignored" : "processed",
      result: result ?? null,
      processed_at: new Date().toISOString()
    })
  });
}

export async function markStripeEventFailed(eventId: string, message: string) {
  await supabaseAdminRequest(`/rest/v1/stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", error_message: message.slice(0, 2000) })
  }).catch(() => undefined);
}

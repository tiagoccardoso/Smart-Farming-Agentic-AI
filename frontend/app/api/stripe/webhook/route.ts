import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { OneTimeOrder, StripeCheckoutSession, supabaseAdminRequest } from "../../../../lib/stripe/humanReview";

export const runtime = "nodejs";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: StripeCheckoutSession;
  };
};

function verifyStripeSignature(payload: string, signatureHeader: string, webhookSecret: string) {
  const signatureParts = signatureHeader.split(",").reduce<Record<string, string[]>>((accumulator, part) => {
    const [key, value] = part.split("=", 2);

    if (key && value) {
      accumulator[key] = [...(accumulator[key] ?? []), value];
    }

    return accumulator;
  }, {});
  const timestamp = signatureParts.t?.[0];
  const signatures = signatureParts.v1 ?? [];

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");

  return signatures.some((signature) => {
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const actualBuffer = Buffer.from(signature, "hex");

    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  });
}

function getMetadataValue(metadata: Record<string, string | undefined> | null | undefined, camelKey: string, snakeKey: string) {
  return metadata?.[camelKey] || metadata?.[snakeKey] || null;
}

async function markHumanReviewOrderAsPaid(session: StripeCheckoutSession) {
  const orderId = getMetadataValue(session.metadata, "orderId", "order_id");
  const metadataCaseId = getMetadataValue(session.metadata, "caseId", "case_id");

  if (!orderId) {
    return { updated: false, reason: "missing_order_id" };
  }

  const orders = await supabaseAdminRequest<OneTimeOrder[]>(
    `/rest/v1/one_time_orders?id=eq.${encodeURIComponent(orderId)}&select=id,case_id,user_id,service_type&limit=1`,
    { method: "GET" }
  );
  const order = orders[0];

  if (!order) {
    return { updated: false, reason: "order_not_found" };
  }

  const caseId = metadataCaseId || order.case_id;

  await supabaseAdminRequest(
    `/rest/v1/one_time_orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payment_status: "paid",
        stripe_checkout_session_id: session.id ?? null
      })
    }
  );

  if (caseId) {
    await supabaseAdminRequest(
      `/rest/v1/agronomic_cases?id=eq.${encodeURIComponent(caseId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          human_review_requested: true,
          human_review_status: "waiting_review",
          status: "waiting_human_review"
        })
      }
    );
  }

  return { updated: true, orderId, caseId };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = request.headers.get("stripe-signature");

    if (!webhookSecret) {
      return NextResponse.json({ error: "Configure STRIPE_WEBHOOK_SECRET para validar webhooks do Stripe." }, { status: 500 });
    }

    if (!signature || !verifyStripeSignature(payload, signature, webhookSecret)) {
      return NextResponse.json({ error: "Assinatura do Stripe inválida." }, { status: 400 });
    }

    const event = JSON.parse(payload) as StripeEvent;

    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return NextResponse.json({ received: true, ignored: true });
    }

    const session = event.data?.object;

    if (!session) {
      return NextResponse.json({ error: "Sessão do Stripe ausente no webhook." }, { status: 400 });
    }

    if (session.payment_status && session.payment_status !== "paid") {
      return NextResponse.json({ received: true, ignored: true, reason: "payment_not_paid" });
    }

    const result = await markHumanReviewOrderAsPaid(session);

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível processar o webhook do Stripe.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

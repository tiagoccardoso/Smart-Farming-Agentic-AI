import crypto from "crypto";

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Validacao da assinatura do webhook (esquema `t=...,v1=...`), com comparacao
 * em tempo constante e tolerancia de horario para evitar replay.
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS
) {
  const signatureParts = signatureHeader.split(",").reduce<Record<string, string[]>>((accumulator, part) => {
    const [key, value] = part.split("=", 2);

    if (key && value) {
      accumulator[key.trim()] = [...(accumulator[key.trim()] ?? []), value.trim()];
    }

    return accumulator;
  }, {});

  const timestamp = signatureParts.t?.[0];
  const signatures = signatureParts.v1 ?? [];

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const timestampSeconds = Number(timestamp);

  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) {
      return false;
    }

    const actualBuffer = Buffer.from(signature, "hex");

    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  });
}

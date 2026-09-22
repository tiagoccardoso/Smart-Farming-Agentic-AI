/**
 * Rate limit dos formularios publicos (envio e assistente de IA).
 *
 * Persistido no Postgres (funcao consume_public_form_rate_limit) porque as
 * rotas rodam em ambiente serverless, onde contadores em memoria nao sao
 * confiaveis. O IP nunca e armazenado em texto puro: apenas um hash com sal.
 *
 * Se a infraestrutura de rate limit estiver indisponivel (ex.: migration ainda
 * nao aplicada), o formulario continua funcionando (fail-open) e um aviso e
 * registrado no log, sem dados pessoais.
 */

import crypto from "node:crypto";
import { supabaseAdminRequest } from "../supabaseAdmin";

export type RateLimitRule = { bucket: string; limit: number; windowSeconds: number };

export class RateLimitError extends Error {
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export const SUBMIT_RATE_LIMITS: RateLimitRule[] = [
  { bucket: "public-request:submit:10m", limit: 5, windowSeconds: 10 * 60 },
  { bucket: "public-request:submit:day", limit: 20, windowSeconds: 24 * 60 * 60 }
];

export const AI_ASSIST_RATE_LIMITS: RateLimitRule[] = [
  { bucket: "public-request:ai:10m", limit: 8, windowSeconds: 10 * 60 },
  { bucket: "public-request:ai:day", limit: 30, windowSeconds: 24 * 60 * 60 }
];

export function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashRateLimitKey(value: string) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "plantasa-public-forms";
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

export async function consumeRateLimits(headers: Headers, rules: RateLimitRule[], message: string) {
  const keyHash = hashRateLimitKey(getClientIp(headers));

  for (const rule of rules) {
    let allowed: unknown = true;

    try {
      allowed = await supabaseAdminRequest<boolean>("/rest/v1/rpc/consume_public_form_rate_limit", {
        method: "POST",
        body: JSON.stringify({
          p_bucket: rule.bucket,
          p_key_hash: keyHash,
          p_limit: rule.limit,
          p_window_seconds: rule.windowSeconds
        })
      });
    } catch {
      console.warn("[public-requests] rate limit indisponivel; seguindo sem bloqueio.", { bucket: rule.bucket });
      continue;
    }

    if (allowed === false) {
      throw new RateLimitError(message);
    }
  }
}

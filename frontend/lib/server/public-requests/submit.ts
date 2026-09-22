/**
 * Registro de uma solicitacao publica (Contato ou Orcamento) com anexos.
 *
 * Fluxo unico para as duas origens, gravando em specialist_visit_requests
 * (a mesma tabela ja acompanhada pela area administrativa):
 *
 *   1. idempotencia: se a chave de envio ja existe, responde sucesso sem gravar
 *      de novo (clique duplo, refresh, reenvio apos timeout);
 *   2. rate limit por IP (hash);
 *   3. upload dos anexos para o bucket privado;
 *   4. insercao da solicitacao ja com os anexos vinculados;
 *   5. se a insercao falhar, os anexos enviados sao removidos.
 */

import crypto from "node:crypto";
import { supabaseAdminRequest } from "../supabaseAdmin";
import { SUBMIT_RATE_LIMITS, consumeRateLimits } from "./rate-limit";
import { deleteStoredAttachments, uploadAttachments, type ValidatedAttachment } from "./attachments";

export type PersistPublicRequestInput = {
  headers: Headers;
  source: string;
  submissionKey: string | null;
  record: Record<string, unknown>;
  attachments: ValidatedAttachment[];
};

export type PersistPublicRequestResult = { requestId: string | null; duplicate: boolean };

async function findBySubmissionKey(submissionKey: string) {
  const rows = await supabaseAdminRequest<Array<{ id: string }>>(
    `/rest/v1/specialist_visit_requests?submission_key=eq.${encodeURIComponent(submissionKey)}&select=id&limit=1`,
    { method: "GET" }
  );
  return rows[0] ?? null;
}

function isMissingAttachmentsColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /attachments/i.test(message) && /column|schema cache/i.test(message);
}

async function insertRequest(row: Record<string, unknown>) {
  await supabaseAdminRequest("/rest/v1/specialist_visit_requests", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row)
  });
}

function isDuplicateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /duplicate key|23505/i.test(message);
}

export async function persistPublicRequest(input: PersistPublicRequestInput): Promise<PersistPublicRequestResult> {
  if (input.submissionKey) {
    const existing = await findBySubmissionKey(input.submissionKey);
    if (existing) {
      return { requestId: existing.id, duplicate: true };
    }
  }

  await consumeRateLimits(
    input.headers,
    SUBMIT_RATE_LIMITS,
    "Recebemos muitas solicitações a partir desta conexão. Aguarde alguns minutos e tente novamente."
  );

  const requestId = crypto.randomUUID();
  const stored = await uploadAttachments(input.source, requestId, input.attachments);

  const row = { ...input.record, id: requestId, source: input.source, submission_key: input.submissionKey };

  try {
    try {
      await insertRequest({ ...row, attachments: stored });
    } catch (error) {
      // Compatibilidade: antes da migration 20260922160000 a coluna `attachments`
      // nao existe. Envios somente de texto continuam funcionando.
      if (stored.length === 0 && isMissingAttachmentsColumn(error)) {
        await insertRequest(row);
      } else {
        throw error;
      }
    }
  } catch (error) {
    await deleteStoredAttachments(stored.map((item) => item.path));

    if (input.submissionKey && isDuplicateError(error)) {
      const existing = await findBySubmissionKey(input.submissionKey).catch(() => null);
      return { requestId: existing?.id ?? null, duplicate: true };
    }

    console.error("[public-requests] falha ao registrar solicitacao.", {
      source: input.source,
      detail: error instanceof Error ? error.message.slice(0, 200) : "erro"
    });
    throw Object.assign(new Error("Não foi possível registrar sua solicitação agora. Tente novamente em instantes."), { status: 500 });
  }

  return { requestId, duplicate: false };
}

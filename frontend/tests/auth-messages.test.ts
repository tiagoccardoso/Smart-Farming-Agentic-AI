/**
 * Mensagens da tela de login: falhas do provedor de autenticação viram textos
 * simples, sem detalhes técnicos, mantendo a distinção entre credenciais,
 * validação, excesso de tentativas e indisponibilidade.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_MESSAGES,
  RECOVERY_MESSAGES,
  classifyLoginFailure,
  classifyRecoveryFailure,
  readAuthFailure,
} from "../lib/auth-messages";

const TECHNICAL_TERMS = /supabase|auth\b|token|grant|invalid|error|failed|fetch/i;

test("credenciais inválidas (formato novo e antigo do provedor)", () => {
  assert.equal(
    classifyLoginFailure({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }).message,
    LOGIN_MESSAGES.invalidCredentials,
  );
  assert.equal(
    classifyLoginFailure({ status: 400, code: "invalid_grant", message: "Invalid login credentials" }).message,
    LOGIN_MESSAGES.invalidCredentials,
  );
  assert.equal(classifyLoginFailure({ status: 400, code: "invalid_credentials" }).status, 401);
});

test("indisponibilidade não vira 'e-mail ou senha incorretos'", () => {
  for (const info of [
    { status: 500, message: "Internal Server Error" },
    { status: 502 },
    { message: "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para usar autenticação." },
    { message: "Erro ao comunicar com o Supabase Auth." },
    {},
  ]) {
    const failure = classifyLoginFailure(info);
    assert.equal(failure.message, LOGIN_MESSAGES.unavailable);
    assert.equal(failure.status, 503);
  }
});

test("e-mail não confirmado, excesso de tentativas e formato inválido têm mensagens próprias", () => {
  assert.equal(
    classifyLoginFailure({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }).message,
    LOGIN_MESSAGES.emailNotConfirmed,
  );
  assert.equal(classifyLoginFailure({ status: 429, code: "over_request_rate_limit" }).message, LOGIN_MESSAGES.tooManyAttempts);
  assert.equal(classifyLoginFailure({ status: 400, code: "validation_failed", message: "Unable to validate email address: invalid format" }).message, LOGIN_MESSAGES.invalidEmail);
});

test("recuperação: formato inválido, limite e indisponibilidade", () => {
  assert.equal(
    classifyRecoveryFailure({ status: 400, code: "validation_failed", message: "Unable to validate email address: invalid format" }).message,
    RECOVERY_MESSAGES.invalidEmail,
  );
  assert.equal(classifyRecoveryFailure({ status: 429, code: "over_email_send_rate_limit" }).message, RECOVERY_MESSAGES.tooManyAttempts);
  assert.equal(classifyRecoveryFailure({ status: 500 }).message, RECOVERY_MESSAGES.unavailable);
});

test("nenhuma mensagem exibida expõe termos técnicos", () => {
  for (const message of [...Object.values(LOGIN_MESSAGES), ...Object.values(RECOVERY_MESSAGES)]) {
    assert.doesNotMatch(message, TECHNICAL_TERMS, message);
  }
});

test("readAuthFailure lê status e código de erros com propriedades extras", () => {
  const error = Object.assign(new Error("Invalid login credentials"), { status: 400, code: "invalid_credentials" });
  assert.deepEqual(readAuthFailure(error), { status: 400, code: "invalid_credentials", message: "Invalid login credentials" });
  assert.deepEqual(readAuthFailure(null), { message: undefined });
});

/**
 * Mensagens amigáveis da tela de login e da recuperação de senha.
 *
 * Os erros do provedor de autenticação chegam com códigos e textos técnicos
 * (em inglês). Aqui eles são classificados em categorias — validação,
 * credenciais, e-mail não confirmado, excesso de tentativas e indisponibilidade
 * — para que a tela mostre uma mensagem simples, sem expor detalhes internos.
 * Os detalhes técnicos continuam nos registros do servidor.
 */

export const LOGIN_MESSAGES = {
  missingFields: "Informe seu e-mail e sua senha.",
  invalidEmail: "Digite um e-mail válido.",
  invalidCredentials: "E-mail ou senha incorretos.",
  emailNotConfirmed: "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.",
  inactiveAccount: "Sua conta está inativa. Entre em contato com o suporte.",
  tooManyAttempts: "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.",
  unavailable: "Não foi possível entrar agora. Tente novamente.",
} as const;

export const RECOVERY_MESSAGES = {
  missingEmail: "Informe seu e-mail para recuperar a senha.",
  invalidEmail: "Digite um e-mail válido.",
  success:
    "Se houver uma conta com esse e-mail, você receberá as instruções para redefinir sua senha.",
  tooManyAttempts: "Muitas solicitações seguidas. Aguarde alguns minutos e tente novamente.",
  unavailable: "Não foi possível solicitar a recuperação de senha. Tente novamente.",
} as const;

export type AuthFailureInfo = {
  status?: number;
  code?: string;
  message?: string;
};

export type FriendlyAuthFailure = {
  message: string;
  status: number;
  kind: string;
};

/** Extrai status/código/mensagem de um erro qualquer, sem depender do formato exato. */
export function readAuthFailure(error: unknown): AuthFailureInfo {
  if (!error || typeof error !== "object") {
    return { message: typeof error === "string" ? error : undefined };
  }

  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };

  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
  };
}

function normalized(info: AuthFailureInfo) {
  return {
    code: (info.code ?? "").toLowerCase(),
    message: (info.message ?? "").toLowerCase(),
    status: info.status,
  };
}

function isRateLimited({ code, message, status }: ReturnType<typeof normalized>) {
  return (
    status === 429 ||
    code.includes("rate_limit") ||
    message.includes("rate limit") ||
    message.includes("too many")
  );
}

function isInvalidEmail({ code, message }: ReturnType<typeof normalized>) {
  return (
    code === "email_address_invalid" ||
    code === "validation_failed" ||
    message.includes("unable to validate email") ||
    message.includes("invalid format") ||
    (message.includes("email address") && message.includes("invalid"))
  );
}

/** Classifica a falha do login com e-mail e senha. */
export function classifyLoginFailure(info: AuthFailureInfo): FriendlyAuthFailure {
  const failure = normalized(info);

  if (failure.code === "email_not_confirmed" || failure.message.includes("email not confirmed")) {
    return { kind: "email_not_confirmed", status: 403, message: LOGIN_MESSAGES.emailNotConfirmed };
  }

  if (
    failure.code === "invalid_credentials" ||
    failure.code === "invalid_grant" ||
    failure.message.includes("invalid login credentials")
  ) {
    return { kind: "invalid_credentials", status: 401, message: LOGIN_MESSAGES.invalidCredentials };
  }

  if (isRateLimited(failure)) {
    return { kind: "rate_limited", status: 429, message: LOGIN_MESSAGES.tooManyAttempts };
  }

  if (isInvalidEmail(failure)) {
    return { kind: "invalid_email", status: 400, message: LOGIN_MESSAGES.invalidEmail };
  }

  return { kind: "unavailable", status: 503, message: LOGIN_MESSAGES.unavailable };
}

/** Classifica a falha da solicitação de recuperação de senha. */
export function classifyRecoveryFailure(info: AuthFailureInfo): FriendlyAuthFailure {
  const failure = normalized(info);

  if (isRateLimited(failure)) {
    return { kind: "rate_limited", status: 429, message: RECOVERY_MESSAGES.tooManyAttempts };
  }

  if (isInvalidEmail(failure)) {
    return { kind: "invalid_email", status: 400, message: RECOVERY_MESSAGES.invalidEmail };
  }

  return { kind: "unavailable", status: 503, message: RECOVERY_MESSAGES.unavailable };
}

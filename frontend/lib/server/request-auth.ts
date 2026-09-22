/**
 * Autenticacao das rotas de API.
 *
 * Aceita o token pelo header Authorization (usado pelas telas que guardam a
 * sessao no localStorage) ou pelo cookie de sessao (usado pelas paginas
 * publicas). Toda validacao de plano acontece no servidor, a partir do usuario
 * resolvido aqui — esconder um botao no React nunca e suficiente.
 */

import { NextRequest } from "next/server";
import { AUTH_ACCESS_COOKIE, AuthenticatedUser, Profile, extractBearerToken, getCurrentProfile, getCurrentUser } from "../auth";

export class UnauthenticatedError extends Error {
  status = 401;

  constructor(message = "Faca login para continuar.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  status = 403;

  constructor(message = "Acesso restrito.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function getRequestToken(request: NextRequest) {
  return extractBearerToken(request.headers.get("authorization")) || request.cookies.get(AUTH_ACCESS_COOKIE)?.value || null;
}

export async function requireUser(request: NextRequest): Promise<{ token: string; user: AuthenticatedUser }> {
  const token = getRequestToken(request);

  if (!token) {
    throw new UnauthenticatedError();
  }

  try {
    const user = await getCurrentUser(token);

    if (!user?.id) {
      throw new UnauthenticatedError();
    }

    return { token, user };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      throw error;
    }
    throw new UnauthenticatedError("Sessao expirada. Faca login novamente.");
  }
}

export async function requireProfile(request: NextRequest) {
  const { token, user } = await requireUser(request);
  const profile = await getCurrentProfile(token, user.id);

  if (!profile) {
    throw new ForbiddenError("Perfil nao encontrado.");
  }

  if ((profile.status ?? "active") !== "active") {
    throw new ForbiddenError("Usuario inativo. Entre em contato com o suporte.");
  }

  return { token, user, profile };
}

export async function requireRole(request: NextRequest, roles: Profile["role"][]) {
  const context = await requireProfile(request);

  if (!roles.includes(context.profile.role)) {
    throw new ForbiddenError("Acesso restrito a administradores e especialistas.");
  }

  return context;
}

/** Converte os erros conhecidos em status HTTP, preservando a mensagem explicativa. */
export function errorStatus(error: unknown, fallback = 500) {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
  }
  return fallback;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

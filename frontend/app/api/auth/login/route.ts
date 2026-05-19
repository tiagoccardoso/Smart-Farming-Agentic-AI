import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  getCurrentProfile,
  supabaseAuthRequest,
} from "../../../../lib/auth";

type PasswordGrantResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
};

function setAuthCookies(response: NextResponse, payload: PasswordGrantResponse) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = payload.expires_in || 60 * 60;

  response.cookies.set(AUTH_ACCESS_COOKIE, payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
  response.cookies.set(AUTH_REFRESH_COOKIE, payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function mapAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid grant") ||
    normalized.includes("invalid_credentials")
  ) {
    return {
      status: 401,
      error: "E-mail ou senha inválidos. Verifique os dados e tente novamente.",
    };
  }

  if (
    normalized.includes("email not confirmed") ||
    normalized.includes("email") && normalized.includes("confirm")
  ) {
    return {
      status: 403,
      error: "Seu usuário ainda não foi confirmado. Verifique seu e-mail antes de entrar.",
    };
  }

  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return {
      status: 503,
      error: "Falha de conexão ao autenticar. Tente novamente em instantes.",
    };
  }

  return {
    status: 401,
    error: "Não foi possível fazer login no momento. Tente novamente.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim() : "";

    if (!normalizedEmail || !password) {
      return NextResponse.json(
        { error: "Informe e-mail e senha." },
        { status: 400 },
      );
    }

    const session = await supabaseAuthRequest<PasswordGrantResponse>(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password }),
      },
    );
    const profile = await getCurrentProfile(session.access_token, session.user.id).catch(
      () => null,
    );

    if ((profile?.status ?? "active") !== "active") {
      return NextResponse.json(
        { error: "Usuário inativo. Entre em contato com o suporte." },
        { status: 403 },
      );
    }

    const response = NextResponse.json({ ...session, profile });
    setAuthCookies(response, session);

    return response;
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Não foi possível fazer login.";

    if (process.env.NODE_ENV !== "production") {
      console.error("Erro de autenticação no login:", rawMessage);
    }

    const mappedError = mapAuthError(rawMessage);

    return NextResponse.json({ error: mappedError.error }, { status: mappedError.status });
  }
}

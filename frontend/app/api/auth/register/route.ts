import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, ensureClientProfile, getAuthCookieDomain, getCurrentProfile, supabaseAuthRequest } from "../../../../lib/auth";

type SignupResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; email?: string };
};

function setAuthCookies(response: NextResponse, payload: Required<Pick<SignupResponse, "access_token" | "refresh_token">> & { expires_in?: number }) {
  const secure = process.env.NODE_ENV === "production";
  const domain = getAuthCookieDomain();

  response.cookies.set(AUTH_ACCESS_COOKIE, payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    ...(domain ? { domain } : {}),
    path: "/",
    maxAge: payload.expires_in || 60 * 60
  });
  response.cookies.set(AUTH_REFRESH_COOKIE, payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    ...(domain ? { domain } : {}),
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function POST(request: NextRequest) {
  try {
    const { fullName, email, password, phone } = await request.json();
    const trimmedFullName = typeof fullName === "string" ? fullName.trim() : "";
    const trimmedPhone = typeof phone === "string" ? phone.trim() : "";

    if (!trimmedFullName) {
      return NextResponse.json({ error: "Informe seu nome completo." }, { status: 400 });
    }

    if (!trimmedPhone) {
      return NextResponse.json({ error: "Informe seu telefone." }, { status: 400 });
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
    }

    const signup = await supabaseAuthRequest<SignupResponse>("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        data: { full_name: trimmedFullName, phone: trimmedPhone, role: "client" }
      })
    });

    if (!signup.access_token || !signup.refresh_token || !signup.user?.id) {
      return NextResponse.json({
        needsEmailConfirmation: true,
        message: "Cadastro criado. Confirme seu e-mail antes de fazer login."
      });
    }

    const profile =
      (await ensureClientProfile(signup.access_token, signup.user.id, trimmedFullName, trimmedPhone).catch(() => null)) ??
      (await getCurrentProfile(signup.access_token, signup.user.id).catch(() => null));
    const response = NextResponse.json({ ...signup, profile });
    setAuthCookies(response, { access_token: signup.access_token, refresh_token: signup.refresh_token, expires_in: signup.expires_in });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível criar sua conta.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

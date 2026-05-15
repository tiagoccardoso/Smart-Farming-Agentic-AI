import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, getCurrentProfile, supabaseAuthRequest } from "../../../../lib/auth";

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
    maxAge
  });
  response.cookies.set(AUTH_REFRESH_COOKIE, payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
    }

    const session = await supabaseAuthRequest<PasswordGrantResponse>("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    const profile = await getCurrentProfile(session.access_token, session.user.id).catch(() => null);
    const response = NextResponse.json({ ...session, profile });
    setAuthCookies(response, session);

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível fazer login.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

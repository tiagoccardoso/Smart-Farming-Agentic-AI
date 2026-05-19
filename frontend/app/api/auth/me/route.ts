import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, getAuthCookieDomain, getCurrentProfile, getCurrentUser, isActiveProfile } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") || "unknown-host";
  const domain = getAuthCookieDomain();
  try {
    const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;

    if (!token) {
      return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
    }

    const user = await getCurrentUser(token);
    const profile = await getCurrentProfile(token, user.id).catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        console.warn("[auth/me] falha ao carregar profile", { host, message });
      }
      return null;
    });

    if (!isActiveProfile(profile)) {
      const response = NextResponse.json({ error: "Usuário inativo. Entre em contato com o suporte." }, { status: 403 });
      response.cookies.set(AUTH_ACCESS_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(domain ? { domain } : {}), path: "/", maxAge: 0 });
      response.cookies.set(AUTH_REFRESH_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(domain ? { domain } : {}), path: "/", maxAge: 0 });
      return response;
    }

    return NextResponse.json({ user, profile, access_token: token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sessão inválida.";

    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth/me] sessão inválida", { host, message });
    }

    return NextResponse.json({ error: message }, { status: 401 });
  }
}

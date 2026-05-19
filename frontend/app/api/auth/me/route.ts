import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, getCurrentProfile, getCurrentUser, isActiveProfile } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;

    if (!token) {
      return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
    }

    const user = await getCurrentUser(token);
    const profile = await getCurrentProfile(token, user.id);

    if (!isActiveProfile(profile)) {
      const response = NextResponse.json({ error: "Usuário inativo. Entre em contato com o suporte." }, { status: 403 });
      response.cookies.delete(AUTH_ACCESS_COOKIE);
      response.cookies.delete(AUTH_REFRESH_COOKIE);
      return response;
    }

    return NextResponse.json({ user, profile, access_token: token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sessão inválida.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  type Profile,
  getCurrentProfile,
  getCurrentUser,
  supabaseAuthRequest,
} from "../../../../lib/auth";

function getToken(request: NextRequest) {
  const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;

  if (!token) {
    throw new Error("Sessão não encontrada.");
  }

  return token;
}

export async function PUT(request: NextRequest) {
  try {
    const token = getToken(request);
    const user = await getCurrentUser(token);
    const { fullName, phone } = await request.json();

    const trimmedFullName = typeof fullName === "string" ? fullName.trim() : "";
    const trimmedPhone = typeof phone === "string" ? phone.trim() : "";

    if (!trimmedFullName) {
      return NextResponse.json({ error: "Informe seu nome completo." }, { status: 400 });
    }

    if (!trimmedPhone) {
      return NextResponse.json({ error: "Informe seu telefone." }, { status: 400 });
    }

    const rows = await supabaseAuthRequest<Profile[]>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,phone,status,unlimited_access,created_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ full_name: trimmedFullName, phone: trimmedPhone }),
      },
      token,
    );

    return NextResponse.json({
      message: "Perfil atualizado com sucesso.",
      profile: rows[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o perfil.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = getToken(request);
    const { email, password } = await request.json();

    const trimmedEmail = typeof email === "string" ? email.trim() : "";
    const trimmedPassword = typeof password === "string" ? password.trim() : "";

    if (!trimmedEmail && !trimmedPassword) {
      return NextResponse.json({ error: "Informe um novo e-mail ou senha." }, { status: 400 });
    }

    if (trimmedPassword && trimmedPassword.length < 6) {
      return NextResponse.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
    }

    await supabaseAuthRequest(
      "/auth/v1/user",
      {
        method: "PUT",
        body: JSON.stringify({
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
          ...(trimmedPassword ? { password: trimmedPassword } : {}),
        }),
      },
      token,
    );

    const user = await getCurrentUser(token);
    const profile = await getCurrentProfile(token, user.id).catch(() => null);

    return NextResponse.json({
      message: trimmedEmail
        ? "Solicitação enviada. Verifique seu e-mail para confirmar a alteração."
        : "Senha atualizada com sucesso.",
      user,
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar suas credenciais.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, getCurrentProfile, getCurrentUser, supabaseAuthRequest } from "../../../../lib/auth";

export async function PUT(request: NextRequest) {
  try {
    const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });

    const user = await getCurrentUser(token);
    const { fullName, phone, city, state, email, newPassword, confirmPassword } = await request.json();

    if (!fullName?.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });

    await supabaseAuthRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ full_name: fullName.trim(), phone: phone?.trim() || null, city: city?.trim() || null, state: state?.trim() || null })
    }, token);

    await supabaseAuthRequest("/auth/v1/user", { method: "PUT", body: JSON.stringify({ data: { full_name: fullName.trim(), name: fullName.trim() } }) }, token);

    let emailUpdateRequested = false;
    if (email && typeof email === "string" && email.trim()) {
      await supabaseAuthRequest("/auth/v1/user", { method: "PUT", body: JSON.stringify({ email: email.trim() }) }, token);
      emailUpdateRequested = true;
    }

    if (newPassword || confirmPassword) {
      if (!newPassword || newPassword.length < 8) return NextResponse.json({ error: "A nova senha deve ter no mínimo 8 caracteres." }, { status: 400 });
      if (newPassword !== confirmPassword) return NextResponse.json({ error: "A confirmação da nova senha não confere." }, { status: 400 });
      await supabaseAuthRequest("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: newPassword }) }, token);
    }

    const profile = await getCurrentProfile(token, user.id);
    return NextResponse.json({ profile, message: "Perfil atualizado com sucesso.", emailUpdateRequested, passwordUpdated: Boolean(newPassword) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar perfil." }, { status: 400 });
  }
}

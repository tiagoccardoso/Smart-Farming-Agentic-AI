import { NextRequest, NextResponse } from "next/server";
import { supabaseAuthRequest } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    const trimmedEmail = typeof email === "string" ? email.trim() : "";

    if (!trimmedEmail) {
      return NextResponse.json(
        { error: "Informe seu e-mail para recuperar a senha." },
        { status: 400 },
      );
    }

    await supabaseAuthRequest("/auth/v1/recover", {
      method: "POST",
      body: JSON.stringify({
        email: trimmedEmail,
        redirect_to: `${request.nextUrl.origin}/login`,
      }),
    });

    return NextResponse.json({
      message: "Enviamos as instruções de recuperação para o e-mail informado.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível enviar a recuperação de senha.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

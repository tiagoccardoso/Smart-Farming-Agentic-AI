import { NextRequest, NextResponse } from "next/server";
import { supabaseAuthRequest } from "../../../../lib/auth";
import { RECOVERY_MESSAGES, classifyRecoveryFailure, readAuthFailure } from "../../../../lib/auth-messages";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({}));
    const trimmedEmail = typeof email === "string" ? email.trim() : "";

    if (!trimmedEmail) {
      return NextResponse.json(
        { error: RECOVERY_MESSAGES.missingEmail, code: "MISSING_EMAIL" },
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

    return NextResponse.json({ message: RECOVERY_MESSAGES.success });
  } catch (error) {
    const failureInfo = readAuthFailure(error);
    const failure = classifyRecoveryFailure(failureInfo);

    // Detalhes técnicos ficam apenas no registro do servidor (sem o e-mail).
    console.error("[auth/recover-password] falha na recuperação", { kind: failure.kind, ...failureInfo });

    return NextResponse.json(
      { error: failure.message, code: failure.kind.toUpperCase() },
      { status: failure.status },
    );
  }
}

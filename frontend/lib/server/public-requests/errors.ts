import { NextResponse } from "next/server";

/**
 * Resposta de erro das rotas publicas: somente erros criados pela propria
 * aplicacao (com `status`) tem a mensagem repassada ao usuario. Erros internos
 * (Supabase, configuracao, rede) viram uma mensagem generica, sem detalhes.
 */
export function publicErrorResponse(error: unknown, fallback: string, scope: string) {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;

  if (Number.isInteger(status) && status >= 400 && status < 600 && error instanceof Error && error.message) {
    return NextResponse.json({ error: error.message }, { status });
  }

  console.error(`[${scope}] erro inesperado.`, {
    name: error instanceof Error ? error.name : typeof error,
    detail: error instanceof Error ? error.message.slice(0, 200) : undefined
  });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

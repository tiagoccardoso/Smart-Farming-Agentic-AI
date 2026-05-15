import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, supabaseAuthRequest } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;

  if (token) {
    await supabaseAuthRequest("/auth/v1/logout", { method: "POST" }, token).catch(() => null);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(AUTH_ACCESS_COOKIE);
  response.cookies.delete(AUTH_REFRESH_COOKIE);
  return response;
}

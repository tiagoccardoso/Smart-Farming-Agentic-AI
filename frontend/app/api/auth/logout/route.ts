import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, getAuthCookieDomain, supabaseAuthRequest } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  const host = request.headers.get("host") || "unknown-host";
  const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;
  const domain = getAuthCookieDomain();

  if (token) {
    await supabaseAuthRequest("/auth/v1/logout", { method: "POST" }, token).catch(() => null);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_ACCESS_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(domain ? { domain } : {}), path: "/", maxAge: 0 });
  response.cookies.set(AUTH_REFRESH_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(domain ? { domain } : {}), path: "/", maxAge: 0 });

  if (process.env.NODE_ENV !== "production") {
    console.info("[auth/logout] sessão removida", { host, hadAccessCookie: Boolean(token), cookieDomain: domain ?? null });
  }
  return response;
}

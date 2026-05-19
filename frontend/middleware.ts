import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, getCurrentProfile, getCurrentUser, hasRole, isActiveProfile } from "./lib/auth";

const protectedRoutes = ["/perfil", "/consultoria-ia", "/enviar-caso", "/revisao-humana", "/meus-relatorios", "/planos", "/dashboard"];
const specialistRoutes = ["/painel-doutora", "/admin/agendamentos"];

function matchesRoute(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requiresAuth = matchesRoute(pathname, protectedRoutes) || matchesRoute(pathname, specialistRoutes);

  if (!requiresAuth) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_ACCESS_COOKIE)?.value;

  if (!token) {
    return loginRedirect(request);
  }

  try {
    const user = await getCurrentUser(token);

    const profile = await getCurrentProfile(token, user.id);

    if (!isActiveProfile(profile)) {
      return loginRedirect(request);
    }

    if (matchesRoute(pathname, specialistRoutes)) {
      if (!hasRole(profile, ["specialist", "admin"])) {
        const url = request.nextUrl.clone();
        url.pathname = "/consultoria-ia";
        url.searchParams.set("auth", "forbidden");
        return NextResponse.redirect(url);
      }
    }

    return NextResponse.next();
  } catch {
    return loginRedirect(request);
  }
}

export const config = {
  matcher: ["/perfil/:path*", "/consultoria-ia/:path*", "/enviar-caso/:path*", "/revisao-humana/:path*", "/meus-relatorios/:path*", "/planos/:path*", "/dashboard/:path*", "/painel-doutora/:path*", "/admin/agendamentos/:path*"]
};

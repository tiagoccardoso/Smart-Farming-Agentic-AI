import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE, getCurrentProfile, getCurrentUser, hasRole, isActiveProfile } from "./lib/auth";

const protectedRoutes = ["/consultoria-ia", "/enviar-caso", "/revisao-humana", "/meus-relatorios", "/planos", "/dashboard", "/perfil"];
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
  const host = request.headers.get("host") || "unknown-host";
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

    let profile = null;
    try {
      profile = await getCurrentProfile(token, user.id);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        console.warn("[auth/middleware] profile indisponível temporariamente", {
          host,
          pathname,
          userId: user.id,
          message,
        });
      }
    }

    if (!isActiveProfile(profile)) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[auth/middleware] usuário inativo, redirecionando para login", {
          host,
          pathname,
          userId: user.id,
        });
      }
      return loginRedirect(request);
    }

    if (matchesRoute(pathname, specialistRoutes)) {
      if (!profile || !hasRole(profile, ["specialist", "admin"])) {
        const url = request.nextUrl.clone();
        url.pathname = "/consultoria-ia";
        url.searchParams.set("auth", profile ? "forbidden" : "profile-unavailable");
        return NextResponse.redirect(url);
      }
    }

    return NextResponse.next();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.warn("[auth/middleware] token inválido ou sessão expirada", {
        host,
        pathname,
        message,
      });
    }
    return loginRedirect(request);
  }
}

export const config = {
  matcher: ["/consultoria-ia/:path*", "/enviar-caso/:path*", "/revisao-humana/:path*", "/meus-relatorios/:path*", "/planos/:path*", "/dashboard/:path*", "/perfil/:path*", "/painel-doutora/:path*", "/admin/agendamentos/:path*"]
};

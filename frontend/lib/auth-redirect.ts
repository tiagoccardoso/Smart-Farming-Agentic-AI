const DEFAULT_POST_AUTH_PATH = "/consultoria-ia";

/** Aceita somente destinos internos conhecidos pelos fluxos de autenticação. */
export function resolvePostAuthRedirect(rawNextPath: string | null | undefined) {
  if (!rawNextPath) return DEFAULT_POST_AUTH_PATH;
  try {
    const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const parsedUrl = new URL(rawNextPath, baseUrl);
    if (parsedUrl.origin !== baseUrl) return DEFAULT_POST_AUTH_PATH;
    const allowed = ["/doencas", "/consultoria-ia", "/revisao-humana"];
    if (!allowed.some((path) => parsedUrl.pathname === path || parsedUrl.pathname.startsWith(`${path}/`))) return DEFAULT_POST_AUTH_PATH;
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return DEFAULT_POST_AUTH_PATH;
  }
}

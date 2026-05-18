import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../lib/agronomic/case";

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await getAuthenticatedUser(token);
  const profile = (await supabaseRequest<any[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`, { method: "GET" }, token))[0];
  if (!profile || !["admin", "specialist"].includes(profile.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const city = url.searchParams.get("city");
  const state = url.searchParams.get("state");
  const sort = url.searchParams.get("sort") === "preferred_date" ? "preferred_date.asc.nullslast" : "created_at.desc";

  const params = ["select=*", `order=${sort}`];
  if (status && status !== "todos") params.push(`status=eq.${encodeURIComponent(status)}`);
  if (city) params.push(`city=ilike.*${encodeURIComponent(city)}*`);
  if (state) params.push(`state=ilike.*${encodeURIComponent(state)}*`);

  const items = await supabaseRequest<any[]>(`/rest/v1/specialist_visit_requests?${params.join("&")}`, { method: "GET" }, token);
  return NextResponse.json({ items });
}

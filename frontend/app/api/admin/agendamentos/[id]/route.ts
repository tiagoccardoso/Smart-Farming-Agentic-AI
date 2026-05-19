import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest } from "../../../../../lib/agronomic/case";

const allowedStatuses = new Set(["novo", "em_contato", "confirmado", "cancelado", "concluido"]);

async function ensureSpecialistOrAdmin(token: string) {
  const user = await getAuthenticatedUser(token);
  const profile = (await supabaseRequest<any[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`, { method: "GET" }, token))[0];
  if (!profile || !["admin", "specialist"].includes(profile.role) || (profile.status ?? "active") !== "active") {
    return false;
  }
  return true;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await ensureSpecialistOrAdmin(token))) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await request.json();
  const status = String(body.status ?? "");
  if (!allowedStatuses.has(status)) return NextResponse.json({ error: "Status inválido." }, { status: 400 });

  await supabaseRequest(`/rest/v1/specialist_visit_requests?id=eq.${encodeURIComponent(params.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status, internal_notes: body.internal_notes ?? null, updated_at: new Date().toISOString() }),
  }, token);

  return NextResponse.json({ ok: true, message: "Agendamento salvo com sucesso." });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await ensureSpecialistOrAdmin(token))) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  await supabaseRequest(`/rest/v1/specialist_visit_requests?id=eq.${encodeURIComponent(params.id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, token);

  return NextResponse.json({ ok: true, message: "Agendamento excluído com sucesso." });
}

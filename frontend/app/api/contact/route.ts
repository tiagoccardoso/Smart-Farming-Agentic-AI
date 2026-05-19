import { NextRequest, NextResponse } from "next/server";

const VISIT_TYPES = new Set(["visita_agricultura_organica", "conversao_propriedade_organica"]);
const REQUEST_TYPES = new Set(["consultoria_geral", "revisao_caso_agricola", ...VISIT_TYPES]);

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase não configurado.");
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = normalize(body?.name);
    const email = normalize(body?.email);
    const phone = normalize(body?.phone);
    const city = normalize(body?.city);
    const state = normalize(body?.state);
    const preferredDate = normalize(body?.preferredDate);
    const preferredTime = normalize(body?.preferredTime);
    const requestType = normalize(body?.requestType);
    const message = normalize(body?.message);
    const submissionKey = normalize(body?.submissionKey) || normalize(request.headers.get("Idempotency-Key"));

    if (!name || !REQUEST_TYPES.has(requestType)) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }
    if (VISIT_TYPES.has(requestType) && (!phone || !city || !state || !preferredDate || !preferredTime)) {
      return NextResponse.json({ error: "Telefone, cidade, estado, dia e horário são obrigatórios para agendamento de visita." }, { status: 400 });
    }

    const { supabaseUrl, anonKey } = getSupabaseConfig();
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };

    if (submissionKey) {
      const duplicate = await fetch(`${supabaseUrl}/rest/v1/specialist_visit_requests?submission_key=eq.${encodeURIComponent(submissionKey)}&select=id&limit=1`, { headers, cache: "no-store" });
      if (duplicate.ok) {
        const rows = await duplicate.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) {
          return NextResponse.json({ message: "Solicitação enviada com sucesso!" });
        }
      }
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/specialist_visit_requests`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ name, email: email || null, phone: phone || null, city: city || null, state: state || null, preferred_date: preferredDate || null, preferred_time: preferredTime || null, request_type: requestType, message: message || null, submission_key: submissionKey || null }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 409 || String(payload?.message || "").includes("duplicate")) {
        return NextResponse.json({ message: "Solicitação enviada com sucesso!" });
      }
      return NextResponse.json({ error: "Não foi possível salvar sua solicitação." }, { status: 500 });
    }

    return NextResponse.json({ message: "Solicitação enviada com sucesso!" });
  } catch {
    return NextResponse.json({ error: "Erro ao enviar solicitação." }, { status: 500 });
  }
}

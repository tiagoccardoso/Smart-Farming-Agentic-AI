import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, generateAgronomicPreAnalysis } from "../../../../lib/agronomic/case";

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para gerar a pré-análise do caso." }, { status: 401 });
    }

    const payload = (await request.json()) as { caseId?: string; question?: string };
    const caseId = payload.caseId?.trim();

    if (!caseId) {
      return NextResponse.json({ error: "Informe o caseId para gerar a pré-análise." }, { status: 400 });
    }

    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }

    const analysis = generateAgronomicPreAnalysis(caseData, payload.question);

    return NextResponse.json({ analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível gerar a pré-análise agronômica.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

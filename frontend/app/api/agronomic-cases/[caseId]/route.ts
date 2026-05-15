import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase } from "../../../../lib/agronomic/case";

export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para consultar o caso agronômico." }, { status: 401 });
    }

    const caseData = await fetchAgronomicCase(params.caseId, token);

    if (!caseData) {
      return NextResponse.json({ error: "Caso não encontrado ou sem permissão de acesso." }, { status: 404 });
    }

    return NextResponse.json({ case: caseData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar o caso agronômico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

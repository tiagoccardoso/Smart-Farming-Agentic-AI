import { NextRequest, NextResponse } from "next/server";
import {
  fetchAgronomicCase,
  fetchCaseChatMessages,
  getAuthenticatedUser,
  insertCaseChatMessage,
} from "../../../../../lib/agronomic/case";

type RouteContext = { params: { caseId: string } };

function getToken(request: NextRequest) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para carregar o chat do caso." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(context.params.caseId, token);

    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Caso não encontrado ou sem permissão." },
        { status: 404 },
      );
    }

    const messages = await fetchCaseChatMessages(context.params.caseId, token);
    return NextResponse.json({ messages });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar o chat.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const token = getToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Faça login para registrar mensagens no chat." },
        { status: 401 },
      );
    }

    const user = await getAuthenticatedUser(token);
    const caseData = await fetchAgronomicCase(context.params.caseId, token);

    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Caso não encontrado ou sem permissão." },
        { status: 404 },
      );
    }

    const payload = (await request.json().catch(() => null)) as {
      role?: "user" | "assistant";
      message?: string;
    } | null;
    const role = payload?.role;
    const message = payload?.message?.trim();

    if (!role || !["user", "assistant"].includes(role) || !message) {
      return NextResponse.json(
        { error: "Informe role e mensagem válidos." },
        { status: 400 },
      );
    }

    const row = await insertCaseChatMessage(
      { caseId: context.params.caseId, userId: user.id, role, message },
      token,
    );
    return NextResponse.json({ message: row });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível salvar a mensagem.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

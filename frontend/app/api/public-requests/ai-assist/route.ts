/**
 * Assistente de escrita com IA dos formularios publicos de Contato e
 * Solicitacao de Orcamento. Retorna apenas uma SUGESTAO de texto: nunca envia
 * nem registra a solicitacao. Protegido por rate limit por IP.
 */

import { NextRequest, NextResponse } from "next/server";
import { ATTACHMENT_LIMITS } from "../../../../lib/public-requests/config";
import { normalizeContactRequestType } from "../../../../lib/public-requests/contact";
import { QUOTE_SERVICE_LABELS } from "../../../../lib/service-quotes";
import { AI_ASSIST_MAX_INPUT_CHARS, AiAssistError, generateWritingSuggestion } from "../../../../lib/server/public-requests/ai-assist";
import { AI_ASSIST_RATE_LIMITS, RateLimitError, consumeRateLimits } from "../../../../lib/server/public-requests/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function text(value: unknown, max: number) {
  const normalized = typeof value === "string" ? value.replace(/\s+\n/g, "\n").trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!payload || (payload.source !== "contact" && payload.source !== "quote")) {
      return NextResponse.json({ error: "Dados inválidos para o assistente." }, { status: 400 });
    }

    // Honeypot: bots preenchem campos invisiveis.
    if (text(payload.website, 200)) {
      return NextResponse.json({ error: "Não foi possível gerar a sugestão." }, { status: 400 });
    }

    const rawMessage = typeof payload.message === "string" ? payload.message : "";
    if (rawMessage.length > AI_ASSIST_MAX_INPUT_CHARS) {
      return NextResponse.json({ error: `O texto excede ${AI_ASSIST_MAX_INPUT_CHARS} caracteres. Resuma um pouco antes de usar a IA.` }, { status: 400 });
    }

    // Mesmo contexto para as duas origens (formulario unico). `serviceType` e
    // `notes` continuam aceitos de clientes antigos.
    const isQuote = payload.source === "quote";
    const requestType = normalizeContactRequestType(payload.requestType ?? payload.serviceType);
    const requestLabel = requestType ? QUOTE_SERVICE_LABELS[requestType] : null;

    await consumeRateLimits(
      request.headers,
      AI_ASSIST_RATE_LIMITS,
      "Você atingiu o limite de uso do assistente de IA por enquanto. Você pode continuar escrevendo e enviar normalmente."
    );

    const result = await generateWritingSuggestion({
      formLabel: isQuote ? "Solicitação de orçamento (Presencial & Projetos Especiais)" : "Contato com a especialista",
      requestLabel,
      city: text(payload.city, 120),
      state: text(payload.state, 60),
      preferredDate: text(payload.preferredDate, 20),
      preferredTime: text(payload.preferredTime, 40),
      notes: text(payload.notes, 1000),
      imageCount: Math.min(Math.max(Number(payload.imageCount) || 0, 0), ATTACHMENT_LIMITS.maxImages),
      hasAudio: payload.hasAudio === true,
      message: rawMessage
    });

    return NextResponse.json({ suggestion: result.suggestion });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message, code: "rate_limited" }, { status: 429 });
    }

    if (error instanceof AiAssistError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error("[public-requests/ai-assist] erro inesperado.", { name: (error as Error)?.name });
    return NextResponse.json(
      { error: "O assistente de IA está indisponível no momento. Você pode escrever e enviar normalmente.", code: "ai_unavailable" },
      { status: 503 }
    );
  }
}

/**
 * Solicitação de parecer agronômico humano para um caso JÁ existente
 * (Consultoria IA e painel de Revisão Humana).
 *
 * Substitui o antigo fluxo "revisão humana avulsa" (pedido pendente + checkout
 * Stripe de R$ 197): o parecer agora é um benefício do plano, consumido de forma
 * atômica por `requestHumanOpinionForCase`. Nenhuma cobrança avulsa é criada.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAgronomicCase, getAuthenticatedUser } from "../agronomic/case";
import { resolveUserAccess } from "../billing/entitlements";
import {
  HumanOpinionUnavailableError,
  normalizeIdempotencyKey,
  requestHumanOpinionForCase,
  toPublicHumanOpinionStatus
} from "../billing/human-opinions";

const PLANS_CTA = { label: "Ver planos", href: "/planos" };

export function humanOpinionErrorResponse(error: HumanOpinionUnavailableError) {
  const status = error.opinionStatus ? toPublicHumanOpinionStatus(error.opinionStatus) : null;

  return NextResponse.json(
    {
      error: error.message,
      reason: error.reason,
      humanOpinion: status,
      cta: error.reason === "plan_without_benefit" || error.reason === "limit_reached" ? PLANS_CTA : null
    },
    { status: error.status }
  );
}

export async function handleCaseHumanOpinionRequest(request: NextRequest, rawCaseId: unknown) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Faça login para solicitar o parecer agronômico." }, { status: 401 });
    }

    const caseId = typeof rawCaseId === "string" ? rawCaseId.trim() : "";
    if (!caseId) {
      return NextResponse.json({ error: "Informe o caso para solicitar o parecer." }, { status: 400 });
    }

    const user = await getAuthenticatedUser(token).catch(() => null);
    if (!user?.id) {
      return NextResponse.json({ error: "Sessão expirada. Faça login novamente." }, { status: 401 });
    }

    // Ownership verificado explicitamente (a leitura pode usar credencial de servidor).
    const caseData = await fetchAgronomicCase(caseId, token);

    if (!caseData || caseData.user_id !== user.id) {
      return NextResponse.json({ error: "Caso não encontrado." }, { status: 404 });
    }

    if (caseData.status === "deleted" || caseData.deleted_at) {
      return NextResponse.json({ error: "Não é possível solicitar parecer para um caso excluído." }, { status: 400 });
    }

    // Já está na fila: resposta idempotente, sem novo consumo.
    if (caseData.human_review_requested && ["waiting_review", "in_review"].includes(caseData.human_review_status ?? "")) {
      return NextResponse.json({
        success: true,
        alreadyRequested: true,
        redirectTo: `/revisao-humana?caseId=${encodeURIComponent(caseId)}`,
        case: {
          id: caseData.id,
          status: caseData.status,
          human_review_requested: caseData.human_review_requested,
          human_review_status: caseData.human_review_status,
          updated_at: caseData.updated_at ?? null
        }
      });
    }

    if (["human_reviewed", "completed"].includes(caseData.status ?? "")) {
      return NextResponse.json({ error: "Este caso já recebeu parecer da especialista." }, { status: 409 });
    }

    const access = await resolveUserAccess(user.id);
    const result = await requestHumanOpinionForCase({
      access,
      caseId,
      idempotencyKey: normalizeIdempotencyKey(request.headers.get("idempotency-key")),
      title: `${caseData.crop || "Caso agronômico"} — parecer agronômico`,
      description: caseData.symptoms || caseData.ai_summary || "Caso enviado para parecer agronômico humano."
    });

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      opinionId: result.opinion.id,
      redirectTo: `/revisao-humana?caseId=${encodeURIComponent(caseId)}`,
      humanOpinion: toPublicHumanOpinionStatus(result.status),
      case: {
        id: caseId,
        status: "waiting_human_review",
        human_review_requested: true,
        human_review_status: "waiting_review",
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    if (error instanceof HumanOpinionUnavailableError) {
      return humanOpinionErrorResponse(error);
    }

    // Detalhe técnico fica no log do servidor; o usuário recebe mensagem amigável.
    console.error("[human-opinion] falha ao solicitar parecer para caso existente", {
      message: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      { error: "Não foi possível solicitar o parecer agora. Nenhum parecer foi consumido. Tente novamente em instantes." },
      { status: 500 }
    );
  }
}

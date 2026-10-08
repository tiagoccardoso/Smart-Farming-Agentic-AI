import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, supabaseRequest, type AgronomicPreAnalysis } from "../../../../../../lib/agronomic/case";
import { splitActivityLogs } from "../../../../../../lib/agronomic/case-freshness";
import { REVIEW_REQUESTED_LOG_ACTION } from "../../../../../../lib/agronomic/client-review";

type Profile = { role: "client" | "specialist" | "admin" };

type TimelineCaseRow = {
  id: string;
  crop: string;
  symptoms: string;
  history: string | null;
  growth_stage: string | null;
  risk_level: string | null;
  ai_summary: string | null;
  ai_recommendation: string | null;
  ai_analysis_json: AgronomicPreAnalysis | null;
  human_review_requested: boolean;
  human_review_status: string | null;
  soil_analysis_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Contexto completo do caso para a especialista: conversa com a IA (texto,
 * fotos, áudios e transcrições), atualizações feitas pelo produtor, análises da
 * IA (atual e anteriores) e histórico de pareceres. Somente leitura.
 * A RLS limita a especialistas/admins e a casos que estão no fluxo de revisão.
 */
export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Faça login para acessar o painel da especialista." }, { status: 401 });

    const user = await getAuthenticatedUser(token);
    const profiles = await supabaseRequest<Profile[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`, { method: "GET" }, token);
    const role = profiles[0]?.role;
    if (role !== "specialist" && role !== "admin") {
      return NextResponse.json({ error: "Acesso restrito a especialistas e administradores." }, { status: 403 });
    }

    const caseId = encodeURIComponent(params.caseId);
    const rows = await supabaseRequest<TimelineCaseRow[]>(
      `/rest/v1/agronomic_cases?id=eq.${caseId}&deleted_at=is.null&select=id,crop,symptoms,history,growth_stage,risk_level,ai_summary,ai_recommendation,ai_analysis_json,human_review_requested,human_review_status,soil_analysis_url,created_at,updated_at&limit=1`,
      { method: "GET" },
      token,
    );
    const caseRow = rows[0];
    if (!caseRow || !caseRow.human_review_requested) {
      return NextResponse.json({ error: "Caso não encontrado na fila de revisão." }, { status: 404 });
    }

    const [messages, rawLogs, images, reviews, pendingQuestions] = await Promise.all([
      supabaseRequest<Array<{ id: string; role: "user" | "assistant"; message: string; message_type: string; file_url: string | null; created_at: string | null }>>(
        `/rest/v1/case_chat_messages?case_id=eq.${caseId}&select=id,role,message,message_type,file_url,created_at&order=created_at.asc`,
        { method: "GET" },
        token,
      ).catch(() => []),
      supabaseRequest<Array<{ id: string; action: string; metadata: Record<string, unknown> | null; created_at: string | null }>>(
        `/rest/v1/case_activity_logs?case_id=eq.${caseId}&select=id,action,metadata,created_at&order=created_at.asc`,
        { method: "GET" },
        token,
      ).catch(() => []),
      supabaseRequest<Array<{ id: string; image_url: string; image_type: string | null; created_at: string | null }>>(
        `/rest/v1/case_images?case_id=eq.${caseId}&select=id,image_url,image_type,created_at&order=created_at.asc`,
        { method: "GET" },
        token,
      ).catch(() => []),
      supabaseRequest<Array<{ id: string; specialist_id: string | null; status: string | null; reviewed_at: string | null; created_at: string | null }>>(
        `/rest/v1/human_reviews?case_id=eq.${caseId}&select=id,specialist_id,status,reviewed_at,created_at&order=created_at.asc`,
        { method: "GET" },
        token,
      ).catch(() => []),
      supabaseRequest<Array<{ question: string; status: string }>>(
        `/rest/v1/case_pending_questions?case_id=eq.${caseId}&select=question,status&order=order_index.asc`,
        { method: "GET" },
        token,
      ).catch(() => []),
    ]);

    const { activityLogs, analysisHistory } = splitActivityLogs(rawLogs);
    const requestLog = [...rawLogs].reverse().find((log) => log.action === REVIEW_REQUESTED_LOG_ACTION);
    const requestRow = reviews.find((review) => !review.specialist_id);
    const requestedAt = requestLog?.created_at ?? requestRow?.created_at ?? null;

    return NextResponse.json(
      {
        case: caseRow,
        requestedAt,
        messages,
        activityLogs,
        analysisHistory,
        images,
        reviews: reviews.map(({ specialist_id, ...review }) => ({ ...review, byCurrentUser: specialist_id === user.id, bySpecialist: Boolean(specialist_id) })),
        pendingQuestions: pendingQuestions.filter((item) => item.status === "pending").map((item) => item.question),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[specialist-timeline] falha", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível carregar o histórico do caso." }, { status: 500 });
  }
}

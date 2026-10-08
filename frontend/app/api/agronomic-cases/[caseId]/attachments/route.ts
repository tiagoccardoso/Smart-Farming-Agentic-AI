import { NextRequest, NextResponse } from "next/server";
import { AUTH_ACCESS_COOKIE } from "../../../../../lib/auth";
import { PlanFeatureUnavailableError, assertPlanFeature } from "../../../../../lib/billing/check-plan-limits";
import { MAX_REQUEST_BODY_BYTES } from "../../../../../lib/agronomic/case-attachments";
import { CaseEditError, addCaseAttachment } from "../../../../../lib/server/agronomic-case-edit";

/**
 * Envia UM anexo (foto ou análise de solo) para um caso existente.
 * Uma requisição por arquivo: mantém o corpo abaixo do limite da Vercel,
 * permite progresso por arquivo e aponta exatamente qual arquivo falhou.
 * Idempotente pelo campo `clientUploadId` (repetir não duplica o anexo).
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.cookies.get(AUTH_ACCESS_COOKIE)?.value ||
    "";

  if (!token) {
    return NextResponse.json({ error: "Faça login para enviar anexos.", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { error: "Arquivo grande demais para envio. Tire outra foto ou escolha uma imagem menor.", code: "FILE_TOO_LARGE" },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo enviado. Tente novamente.", code: "INVALID_BODY" }, { status: 400 });
  }

  const file = formData.get("file");
  const kind = formData.get("kind") === "soil_analysis" ? "soil_analysis" : "photo";
  const clientUploadId = typeof formData.get("clientUploadId") === "string" ? String(formData.get("clientUploadId")) : null;

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Selecione um arquivo para enviar.", code: "FILE_MISSING" }, { status: 400 });
  }

  try {
    const result = await addCaseAttachment({
      caseId: params.caseId,
      token,
      file,
      kind,
      clientUploadId,
      checkPlanFeature: assertPlanFeature,
    });
    return NextResponse.json({
      ok: true,
      kind,
      image: result.image,
      soilAnalysisUrl: result.soilAnalysisUrl,
      alreadyExisted: result.alreadyExisted,
    });
  } catch (error) {
    if (error instanceof PlanFeatureUnavailableError) {
      return NextResponse.json({ error: error.message, code: "PLAN_FEATURE_UNAVAILABLE", cta: error.cta }, { status: error.status });
    }
    if (error instanceof CaseEditError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[agronomic-case-attachment] falha inesperada", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: `Não foi possível enviar "${file.name}". Tente novamente.`, code: "UNEXPECTED" }, { status: 500 });
  }
}

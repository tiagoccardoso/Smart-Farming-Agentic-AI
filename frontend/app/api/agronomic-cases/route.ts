import { NextRequest, NextResponse } from "next/server";

const STORAGE_BUCKET = "agronomic-cases";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ACCEPTED_SOIL_ANALYSIS_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_SOIL_ANALYSIS_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

class FriendlyRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para salvar casos.");
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  const value = requiredText(formData, key);
  return value.length > 0 ? value : null;
}

function optionalNumber(formData: FormData, key: string) {
  const value = requiredText(formData, key).replace(",", ".");

  if (!value) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function sanitizeFileName(fileName: string) {
  const sanitized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitized || "arquivo";
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateUploadFile(file: File, allowedTypes: string[], allowedExtensions: string[], label: string) {
  const extension = getFileExtension(file.name);

  if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(extension)) {
    throw new FriendlyRequestError(`${label} "${file.name}" não está em um formato aceito.`);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FriendlyRequestError(`${label} "${file.name}" excede o limite de 10MB.`);
  }
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit,
  token: string,
  config: { supabaseUrl: string; anonKey: string }
) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || "Erro ao comunicar com o Supabase. Tente novamente em instantes.");
  }

  return payload as T;
}

async function uploadToStorage(file: File, path: string, token: string, config: { supabaseUrl: string; anonKey: string }) {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: Buffer.from(await file.arrayBuffer()),
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 409) {
      throw new FriendlyRequestError(`Já existe um arquivo chamado ${file.name} neste caso. Renomeie o arquivo e tente novamente.`, 409);
    }

    throw new Error(payload?.message || payload?.error || `Não foi possível enviar o arquivo ${file.name}. Tente novamente.`);
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

async function getAuthenticatedUser(token: string, config: { supabaseUrl: string; anonKey: string }) {
  return supabaseRequest<{ id: string }>(
    "/auth/v1/user",
    { method: "GET", headers: { "Content-Type": "application/json" } },
    token,
    config
  );
}

export async function POST(request: NextRequest) {
  try {
    const config = getSupabaseConfig();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return NextResponse.json({ error: "Faça login para enviar um caso agronômico." }, { status: 401 });
    }

    const formData = await request.formData();
    const crop = requiredText(formData, "crop");
    const state = requiredText(formData, "state");
    const symptoms = requiredText(formData, "symptoms");

    if (!crop || !state || !symptoms) {
      return NextResponse.json({ error: "Preencha cultura, estado e sintomas observados." }, { status: 400 });
    }

    const photoFiles = formData.getAll("photos").filter(isFile);
    const soilAnalysis = formData.get("soilAnalysis");

    photoFiles.forEach((photo) => validateUploadFile(photo, ACCEPTED_PHOTO_TYPES, ACCEPTED_PHOTO_EXTENSIONS, "A imagem"));

    if (isFile(soilAnalysis)) {
      validateUploadFile(soilAnalysis, ACCEPTED_SOIL_ANALYSIS_TYPES, ACCEPTED_SOIL_ANALYSIS_EXTENSIONS, "A análise de solo");
    }

    const user = await getAuthenticatedUser(token, config);
    const farmName = optionalText(formData, "farmName");
    const city = optionalText(formData, "city");
    const areaHectares = optionalNumber(formData, "areaHectares");
    const soilType = optionalText(formData, "soilType");

    const farmPayload = {
      user_id: user.id,
      name: farmName,
      city,
      state,
      area_hectares: areaHectares,
      soil_type: soilType
    };

    const farms = await supabaseRequest<Array<{ id: string }>>(
      "/rest/v1/farms?select=id&name=eq." + encodeURIComponent(farmName ?? "") + "&city=eq." + encodeURIComponent(city ?? "") + "&state=eq." + encodeURIComponent(state) + "&limit=1",
      { method: "GET" },
      token,
      config
    );

    const farm = farms[0]
      ? (
          await supabaseRequest<Array<{ id: string }>>(
            `/rest/v1/farms?id=eq.${farms[0].id}&select=id`,
            { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(farmPayload) },
            token,
            config
          )
        )[0]
      : (
          await supabaseRequest<Array<{ id: string }>>(
            "/rest/v1/farms?select=id",
            { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(farmPayload) },
            token,
            config
          )
        )[0];

    const createdCase = (
      await supabaseRequest<Array<{ id: string }>>(
        "/rest/v1/agronomic_cases?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: user.id,
            farm_id: farm.id,
            crop,
            growth_stage: optionalText(formData, "growthStage"),
            symptoms,
            history: optionalText(formData, "managementHistory"),
            status: "submitted"
          })
        },
        token,
        config
      )
    )[0];

    const uploadedImages = [];

    for (const photo of photoFiles) {
      const path = `${user.id}/${createdCase.id}/${sanitizeFileName(photo.name)}`;
      const imageUrl = await uploadToStorage(photo, path, token, config);
      uploadedImages.push({ case_id: createdCase.id, user_id: user.id, image_url: imageUrl, image_type: photo.type || "image" });
    }

    if (uploadedImages.length > 0) {
      await supabaseRequest(
        "/rest/v1/case_images",
        { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(uploadedImages) },
        token,
        config
      );
    }

    if (isFile(soilAnalysis)) {
      const path = `${user.id}/${createdCase.id}/${sanitizeFileName(soilAnalysis.name)}`;
      const soilAnalysisUrl = await uploadToStorage(soilAnalysis, path, token, config);

      await supabaseRequest(
        `/rest/v1/agronomic_cases?id=eq.${createdCase.id}`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ soil_analysis_url: soilAnalysisUrl }) },
        token,
        config
      );
    }

    return NextResponse.json({ caseId: createdCase.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar o caso agronômico.";
    const status = error instanceof FriendlyRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

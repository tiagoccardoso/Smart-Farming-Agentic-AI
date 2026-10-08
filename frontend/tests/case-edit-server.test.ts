/**
 * Edição de casos no servidor (causa raiz dos salvamentos perdidos):
 * - casos em revisão humana voltam a ser editáveis (grava com service role
 *   depois de validar a propriedade com o token do usuário);
 * - só campos de conteúdo são alterados (nunca status/revisão/IA);
 * - UPDATE sem linha afetada é erro, não sucesso silencioso;
 * - anexos idempotentes e sem arquivo órfão quando o banco falha.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CaseEditError, addCaseAttachment, parseCaseContentInput, updateCaseContent } from "../lib/server/agronomic-case-edit";

const USER = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER = "22222222-bbbb-4bbb-8bbb-222222222222";
const CASE = "33333333-cccc-4ccc-8ccc-333333333333";
const FARM = "44444444-dddd-4ddd-8ddd-444444444444";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

const originalFetch = globalThis.fetch;

function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
}

function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), String(value)]));
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call = { url, method, headers, body };
    calls.push(call);
    const result = handler(call);
    if (!result) throw new Error(`não mapeado: ${method} ${url}`);
    const status = result.status ?? 200;
    const text = result.body === undefined ? "" : JSON.stringify(result.body);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => (text ? JSON.parse(text) : null) } as unknown as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE,
    user_id: USER,
    farm_id: FARM,
    status: "waiting_human_review",
    deleted_at: null,
    human_review_requested: true,
    human_review_status: "in_review",
    crop: "Soja",
    growth_stage: null,
    symptoms: "Antigo",
    history: null,
    soil_analysis_url: null,
    ...overrides,
  };
}

const input = parseCaseContentInput({ crop: "Soja", state: "GO", symptoms: "Manchas evoluíram", city: "Rio Verde", areaHectares: "10,5" });

function baseHandler(extra: Handler = () => undefined, row = caseRow()): Handler {
  return (call) => {
    const custom = extra(call);
    if (custom) return custom;
    if (call.url.endsWith("/auth/v1/user")) return { body: { id: USER } };
    if (call.url.includes("/rest/v1/agronomic_cases") && call.method === "GET") return { body: [row] };
    if (call.url.includes("/rest/v1/farms") && call.method === "GET") return { body: [{ id: FARM, name: null, city: null, state: "GO", area_hectares: null, soil_type: null }] };
    if (call.url.includes("/rest/v1/farms") && call.method === "PATCH") return { body: [{ id: FARM }] };
    if (call.url.includes("/rest/v1/farms") && call.method === "POST") return { status: 201, body: [{ id: FARM }] };
    if (call.url.includes("/rest/v1/agronomic_cases") && call.method === "PATCH") return { body: [{ id: CASE, updated_at: "2026-10-08T00:00:00Z" }] };
    if (call.url.includes("/rest/v1/case_activity_logs")) return { status: 201 };
    return undefined;
  };
}

test("caso em revisão humana é editável; grava com service role e só campos de conteúdo", async () => {
  setEnv();
  const mock = mockFetch(baseHandler());
  try {
    const result = await updateCaseContent({ caseId: CASE, token: "user-token", input });
    const ownership = mock.calls.find((call) => call.url.includes("/agronomic_cases") && call.method === "GET")!;
    assert.equal(ownership.headers.authorization, "Bearer user-token", "propriedade validada com o token do usuário");
    const patch = mock.calls.find((call) => call.url.includes("/agronomic_cases") && call.method === "PATCH")!;
    assert.equal(patch.headers.authorization, "Bearer service-key");
    assert.match(patch.url, new RegExp(`user_id=eq.${USER}`));
    assert.deepEqual(Object.keys(patch.body as object).sort(), ["crop", "growth_stage", "history", "symptoms"]);
    assert.equal(patch.headers.prefer, "return=representation");
    assert.ok(result.changedFields.includes("symptoms"));
    assert.ok(result.changedFields.includes("farm.area_hectares"));
    const logCall = mock.calls.find((call) => call.url.includes("case_activity_logs"))!;
    assert.equal((logCall.body as { metadata: { kind: string } }).metadata.kind, "case_updated");
  } finally {
    mock.restore();
  }
});

test("UPDATE sem linha afetada é erro (não sucesso silencioso)", async () => {
  setEnv();
  const mock = mockFetch(baseHandler((call) => (call.url.includes("/agronomic_cases") && call.method === "PATCH" ? { body: [] } : undefined)));
  try {
    await assert.rejects(updateCaseContent({ caseId: CASE, token: "t", input }), (error: unknown) => error instanceof CaseEditError && error.code === "CASE_NOT_UPDATED");
  } finally {
    mock.restore();
  }
});

test("caso de outro usuário: 403 e nenhuma gravação", async () => {
  setEnv();
  const mock = mockFetch(baseHandler(undefined, caseRow({ user_id: OTHER })));
  try {
    await assert.rejects(updateCaseContent({ caseId: CASE, token: "t", input }), (error: unknown) => error instanceof CaseEditError && error.status === 403);
    assert.equal(mock.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    mock.restore();
  }
});

test("caso sem propriedade: cria a propriedade e vincula (antes era descartado)", async () => {
  setEnv();
  const mock = mockFetch(baseHandler(undefined, caseRow({ farm_id: null })));
  try {
    await updateCaseContent({ caseId: CASE, token: "t", input });
    const created = mock.calls.find((call) => call.url.includes("/rest/v1/farms") && call.method === "POST")!;
    assert.equal((created.body as { user_id: string }).user_id, USER);
    const patch = mock.calls.find((call) => call.url.includes("/agronomic_cases") && call.method === "PATCH")!;
    assert.equal((patch.body as { farm_id: string }).farm_id, FARM);
  } finally {
    mock.restore();
  }
});

test("remover foto: apaga só fotos do caso e mantém o arquivo se há parecer humano", async () => {
  setEnv();
  const image = { id: "55555555-eeee-4eee-8eee-555555555555", case_id: CASE, image_url: `https://projeto.supabase.co/storage/v1/object/public/agronomic-cases/${USER}/${CASE}/photos/a.jpg`, image_type: "image/jpeg", created_at: null };
  const mock = mockFetch(
    baseHandler((call) => {
      if (call.url.includes("/rest/v1/case_images") && call.method === "GET") return { body: [image] };
      if (call.url.includes("/rest/v1/case_images") && call.method === "DELETE") return { body: [image] };
      return undefined;
    }),
  );
  try {
    const result = await updateCaseContent({ caseId: CASE, token: "t", input, removeImageIds: [image.id] });
    assert.equal(result.removedImages, 1);
    const del = mock.calls.find((call) => call.url.includes("/case_images") && call.method === "DELETE")!;
    assert.match(del.url, new RegExp(`case_id=eq.${CASE}`));
    assert.equal(mock.calls.some((call) => call.url.includes("/storage/v1/object") && call.method === "DELETE"), false);
  } finally {
    mock.restore();
  }
});

test("validação de campos obrigatórios", () => {
  assert.throws(() => parseCaseContentInput({ crop: "", state: "", symptoms: "" }), (error: unknown) => error instanceof CaseEditError && Boolean(error.fieldErrors?.crop && error.fieldErrors?.state && error.fieldErrors?.symptoms));
  assert.throws(() => parseCaseContentInput({ crop: "a", state: "b", symptoms: "c", areaHectares: "-1" }), (error: unknown) => error instanceof CaseEditError && Boolean(error.fieldErrors?.areaHectares));
});

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], "Foto Lavoura.JPG", { type: "image/jpeg" });

test("anexo repetido (mesmo clientUploadId) não duplica arquivo nem registro", async () => {
  setEnv();
  const mock = mockFetch(
    baseHandler((call) => {
      if (call.url.includes("/storage/v1/object/agronomic-cases/") && call.method === "POST") return { status: 400, body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } };
      if (call.url.includes("/rest/v1/case_images") && call.method === "GET") return { body: [{ id: "img-1", case_id: CASE, image_url: "x", image_type: "image/jpeg", created_at: null }] };
      return undefined;
    }),
  );
  try {
    const result = await addCaseAttachment({ caseId: CASE, token: "t", file: jpeg(), kind: "photo", clientUploadId: "foto-abc12345" });
    assert.equal(result.alreadyExisted, true);
    assert.equal(result.image?.id, "img-1");
    assert.equal(mock.calls.some((call) => call.url.includes("/rest/v1/case_images") && call.method === "POST"), false);
    const upload = mock.calls.find((call) => call.url.includes("/storage/v1/object/agronomic-cases/"))!;
    assert.match(upload.url, new RegExp(`${USER}/${CASE}/photos/foto-abc12345-foto-lavoura.jpg$`));
  } finally {
    mock.restore();
  }
});

test("falha ao vincular a foto no banco remove o arquivo enviado (sem órfão)", async () => {
  setEnv();
  const mock = mockFetch(
    baseHandler((call) => {
      if (call.url.includes("/storage/v1/object/agronomic-cases/") && call.method === "POST") return { body: { Key: "ok" } };
      if (call.url.includes("/rest/v1/case_images") && call.method === "GET") return { body: [] };
      if (call.url.includes("/rest/v1/case_images") && call.method === "POST") return { status: 500, body: { message: "erro" } };
      if (call.url.endsWith("/storage/v1/object/agronomic-cases") && call.method === "DELETE") return { body: [] };
      return undefined;
    }),
  );
  try {
    await assert.rejects(addCaseAttachment({ caseId: CASE, token: "t", file: jpeg(), kind: "photo", clientUploadId: "foto-xyz12345" }), CaseEditError);
    const cleanup = mock.calls.find((call) => call.method === "DELETE" && call.url.endsWith("/storage/v1/object/agronomic-cases"))!;
    assert.ok(cleanup, "arquivo removido do storage");
    assert.deepEqual((cleanup.body as { prefixes: string[] }).prefixes, [`${USER}/${CASE}/photos/foto-xyz12345-foto-lavoura.jpg`]);
  } finally {
    mock.restore();
  }
});

test("formato inválido é recusado antes de qualquer upload", async () => {
  setEnv();
  const mock = mockFetch(baseHandler());
  try {
    const text = new File(["texto"], "nota.txt", { type: "text/plain" });
    await assert.rejects(addCaseAttachment({ caseId: CASE, token: "t", file: text, kind: "photo" }), (error: unknown) => error instanceof CaseEditError && error.code === "UNSUPPORTED_TYPE");
    assert.equal(mock.calls.some((call) => call.url.includes("/storage/")), false);
  } finally {
    mock.restore();
  }
});

test("plano sem fotos: recusa antes do upload", async () => {
  setEnv();
  const mock = mockFetch(baseHandler());
  try {
    await assert.rejects(
      addCaseAttachment({
        caseId: CASE,
        token: "t",
        file: jpeg(),
        kind: "photo",
        checkPlanFeature: async () => {
          throw new Error("plano");
        },
      }),
      /plano/,
    );
    assert.equal(mock.calls.some((call) => call.url.includes("/storage/")), false);
  } finally {
    mock.restore();
  }
});

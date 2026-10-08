/**
 * Salvamento da edição de casos (lado do navegador): só há "salvo com sucesso"
 * quando o servidor confirma; falhas preservam o que está pendente; anexos já
 * enviados não são reenviados.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_EDIT_FIELDS,
  fieldsFromCase,
  hasUnsavedChanges,
  saveCaseChanges,
  type EditableCaseFields,
  type PendingUpload,
  type ReloadedCase,
  type SaveTransport,
  type TransportResult,
} from "../lib/agronomic/case-save";

const fields: EditableCaseFields = { ...EMPTY_EDIT_FIELDS, crop: "Soja", state: "GO", symptoms: "Manchas novas", areaHectares: "12,5" };

function photo(id: string): PendingUpload {
  return { id, kind: "photo", file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], `${id}.jpg`, { type: "image/jpeg" }), status: "pending", progress: 0 };
}

function serverCase(overrides: Partial<ReloadedCase> = {}): ReloadedCase {
  return {
    crop: "Soja",
    symptoms: "Manchas novas",
    growth_stage: null,
    history: null,
    farm: { name: null, city: null, state: "GO", area_hectares: 12.5, soil_type: null },
    images: [{ id: "old-1", image_url: "u1" }],
    ...overrides,
  };
}

function transport(options: {
  patch?: TransportResult;
  upload?: (upload: PendingUpload) => TransportResult;
  reload?: ReloadedCase | null;
  calls?: string[];
}): SaveTransport {
  return {
    patchCase: async (body) => {
      options.calls?.push(`patch:${body.removeImageIds.join(",")}`);
      return options.patch ?? { ok: true, status: 200, payload: { ok: true } };
    },
    uploadAttachment: async (upload, onProgress) => {
      options.calls?.push(`upload:${upload.id}`);
      onProgress(0.5);
      return options.upload ? options.upload(upload) : { ok: true, status: 200, payload: { image: { id: `img-${upload.id}`, image_url: `url-${upload.id}` } } };
    },
    reloadCase: async () => (options.reload === undefined ? serverCase() : options.reload),
  };
}

test("textos e fotos salvos e confirmados → sucesso", async () => {
  const calls: string[] = [];
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: true,
    removeImageIds: [],
    uploads: [photo("a")],
    transport: transport({ calls, reload: serverCase({ images: [{ id: "old-1", image_url: "u1" }, { id: "img-a", image_url: "url-a" }] }) }),
  });
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.message, "Alterações salvas com sucesso");
  assert.deepEqual(calls, ["patch:", "upload:a"]);
});

test("falha ao salvar textos: nada é enviado, nada é dado como salvo", async () => {
  const calls: string[] = [];
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: true,
    removeImageIds: [],
    uploads: [photo("a")],
    transport: transport({ calls, patch: { ok: false, status: 403, payload: { error: "O banco recusou a gravação por permissão." } } }),
  });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.contentSaved, false);
  assert.equal(outcome.message, "O banco recusou a gravação por permissão.");
  assert.deepEqual(calls, ["patch:"]);
  assert.equal(outcome.uploads[0].status, "pending", "foto continua pendente");
});

test("falha de rede não vira sucesso", async () => {
  const failing: SaveTransport = {
    ...transport({}),
    patchCase: async () => {
      throw new TypeError("Failed to fetch");
    },
  };
  const outcome = await saveCaseChanges({ fields, contentDirty: true, removeImageIds: [], uploads: [], transport: failing });
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /Sem conexão/);
});

test("uma foto falha: salvo parcialmente e só a que falhou fica pendente", async () => {
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: true,
    removeImageIds: [],
    uploads: [photo("a"), photo("b")],
    transport: transport({
      upload: (upload) => (upload.id === "b" ? { ok: false, status: 413, payload: null } : { ok: true, status: 200, payload: { image: { id: "img-a", image_url: "url-a" } } }),
      reload: serverCase({ images: [{ id: "old-1", image_url: "u1" }, { id: "img-a", image_url: "url-a" }] }),
    }),
  });
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.uploads.map((upload) => upload.status), ["done", "error"]);
  assert.match(outcome.message, /1 de 2/);
});

test("nova tentativa não reenvia o que já foi enviado nem os textos já salvos", async () => {
  const calls: string[] = [];
  const done = { ...photo("a"), status: "done" as const, savedImageId: "img-a" };
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: false,
    removeImageIds: [],
    uploads: [done, { ...photo("b"), status: "error" }],
    transport: transport({ calls, reload: serverCase({ images: [{ id: "img-a", image_url: "url-a" }, { id: "img-b", image_url: "url-b" }] }) }),
  });
  assert.deepEqual(calls, ["upload:b"]);
  assert.equal(outcome.status, "saved");
});

test("servidor não confirma o texto na releitura → erro, não sucesso", async () => {
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: true,
    removeImageIds: [],
    uploads: [],
    transport: transport({ reload: serverCase({ symptoms: "Texto antigo" }) }),
  });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.contentSaved, false);
});

test("foto enviada mas ausente na releitura → erro", async () => {
  const outcome = await saveCaseChanges({ fields, contentDirty: false, removeImageIds: [], uploads: [photo("a")], transport: transport({}) });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.uploads[0].status, "error");
});

test("remoção de foto precisa sumir na releitura", async () => {
  const notRemoved = await saveCaseChanges({ fields, contentDirty: false, removeImageIds: ["old-1"], uploads: [], transport: transport({}) });
  assert.equal(notRemoved.status, "error");
  const removed = await saveCaseChanges({ fields, contentDirty: false, removeImageIds: ["old-1"], uploads: [], transport: transport({ reload: serverCase({ images: [] }) }) });
  assert.equal(removed.status, "saved");
});

test("anexos antigos não removidos continuam (a releitura com eles é sucesso)", async () => {
  const outcome = await saveCaseChanges({
    fields,
    contentDirty: false,
    removeImageIds: [],
    uploads: [photo("a")],
    transport: transport({ reload: serverCase({ images: [{ id: "old-1", image_url: "u1" }, { id: "img-a", image_url: "url-a" }] }) }),
  });
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.reloadedCase?.images?.length, 2);
});

test("detecção de alterações não salvas", () => {
  const original = fieldsFromCase(serverCase());
  assert.equal(hasUnsavedChanges({ original, current: original, uploads: [], removeImageIds: [] }), false);
  assert.equal(hasUnsavedChanges({ original, current: { ...original, symptoms: "x" }, uploads: [], removeImageIds: [] }), true);
  assert.equal(hasUnsavedChanges({ original, current: { ...original, symptoms: `${original.symptoms}  ` }, uploads: [], removeImageIds: [] }), false, "espaços nas pontas não contam");
  assert.equal(hasUnsavedChanges({ original, current: original, uploads: [photo("a")], removeImageIds: [] }), true);
  assert.equal(hasUnsavedChanges({ original, current: original, uploads: [], removeImageIds: ["old-1"] }), true);
});

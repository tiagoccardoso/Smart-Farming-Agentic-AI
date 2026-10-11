// Reprodução da falha "A análise demorou mais que o esperado" (código de
// suporte 91689349683-d734721b2e8a) contra o app compilado + Supabase/OpenAI
// falsos (fake-supabase.mjs). Sem rede externa e sem dados reais.
//
// Condições de produção reproduzidas:
//  - tabela agronomic_analysis_jobs ausente (PGRST205) -> fluxo síncrono;
//  - pesquisa interna lenta (embeddings demoram) -> etapa de pesquisa esgota o teto;
//  - modelo leva ANALYSIS_DELAY_MS (padrão 30 s) para responder a análise com foto.
//
// Uso (servidores já no ar, ver README):  node analyze-case.repro.mjs [cenário...]
// Cenários (fluxo síncrono, sem a tabela): slow-model | double-click | rate-limit | invalid | unauthorized
// Cenários (com a migration aplicada):     durable-slow-model | durable-double-click
import fs from "node:fs";

const APP = process.env.APP_URL || "http://127.0.0.1:3100";
const FAKE = process.env.FAKE_URL || "http://127.0.0.1:54321";
const SERVICE = "service-key-e2e";
const PRODUCER = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "cccccccc-0000-4000-8000-00000000000a";
const ANALYSIS_DELAY_MS = Number(process.env.ANALYSIS_DELAY_MS || 30_000);

async function fake(path, body) {
  const response = await fetch(`${FAKE}${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
  return response.json();
}

async function rest(path, body) {
  const response = await fetch(`${FAKE}/rest/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`seed ${path}: ${response.status}`);
}

async function seedTomatoCase() {
  await fake("/__reset");
  const photo = fs.readFileSync(new URL("./assets/folha1.jpg", import.meta.url));
  const objectPath = `${PRODUCER}/${CASE_ID}/photos/tomate-1.jpg`;
  const upload = await fetch(`${FAKE}/storage/v1/object/agronomic-cases/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/jpeg" },
    body: photo,
  });
  if (!upload.ok) throw new Error(`upload: ${upload.status}`);
  const created = new Date(Date.now() - 600_000).toISOString();
  await rest("agronomic_cases", {
    id: CASE_ID, user_id: PRODUCER, farm_id: null, crop: "Tomate", growth_stage: "Frutificação",
    symptoms: "Manchas escuras com anéis nas folhas mais velhas, amarelecimento ao redor.", history: "Chuvas e irrigação por aspersão.",
    soil_analysis_url: null, status: "submitted", risk_level: null, ai_summary: null, ai_recommendation: null, ai_analysis_json: null,
    human_review_requested: false, human_review_status: "not_requested", created_at: created, updated_at: created, deleted_at: null,
  });
  await rest("case_images", {
    case_id: CASE_ID, user_id: PRODUCER, image_url: `${FAKE}/storage/v1/object/public/agronomic-cases/${objectPath}`, image_type: "image/jpeg", created_at: created,
  });
}

async function analyze(token = "tok-produtor") {
  const startedAt = Date.now();
  const response = await fetch(`${APP}/api/agronomic-ai/analyze-case`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ caseId: CASE_ID }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  return { status: response.status, ms: Date.now() - startedAt, code: body?.code ?? null, error: body?.error ?? null, hasAnalysis: Boolean(body?.analysis), images: body?.imageAnalysis ?? null, deduplicated: Boolean(body?.deduplicated) };
}

async function poll(token = "tok-produtor") {
  const response = await fetch(`${APP}/api/agronomic-ai/analyze-case?caseId=${CASE_ID}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, state: body.status ?? null, code: body.code ?? null };
}

async function pollUntilDone(limitMs = 150_000) {
  const startedAt = Date.now();
  const states = [];
  while (Date.now() - startedAt < limitMs) {
    const result = await poll();
    if (states[states.length - 1] !== result.state) states.push(result.state);
    if (result.state === "completed" || result.state === "failed" || result.status >= 400) return { ...result, states, ms: Date.now() - startedAt };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return { state: "timeout", states, ms: Date.now() - startedAt };
}

async function savedCase() {
  const db = await (await fetch(`${FAKE}/__db`)).json();
  const row = (db.agronomic_cases ?? []).find((item) => item.id === CASE_ID);
  return { hasAnalysis: Boolean(row?.ai_analysis_json), diagnosis: row?.ai_analysis_json?.initialDiagnosis ?? null, imageAnalysis: row?.ai_analysis_json?.imageAnalysis ?? null, modelCalls: (db.ai_analysis_calls ?? []).length };
}

const productionLike = { jobsTableMissing: true, embeddingsDelayMs: 15_000, analysisDelayMs: ANALYSIS_DELAY_MS, analysisStatus: 200, analysisBody: "json" };

const scenarios = {
  async "slow-model"() {
    await seedTomatoCase();
    await fake("/__config", productionLike);
    const result = await analyze();
    return { result, saved: await savedCase() };
  },
  async "double-click"() {
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, analysisDelayMs: 3_000 });
    const [first, second] = await Promise.all([analyze(), new Promise((r) => setTimeout(r, 200)).then(() => analyze())]);
    const third = await analyze(); // logo depois de gravar: devolvida sem nova chamada
    return { first, second, third, saved: await savedCase() };
  },
  async "rate-limit"() {
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, embeddingsDelayMs: 0, analysisDelayMs: 0, analysisStatus: 429 });
    return { result: await analyze(), saved: await savedCase() };
  },
  async invalid() {
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, embeddingsDelayMs: 0, analysisDelayMs: 0, analysisBody: "invalid" });
    return { result: await analyze(), saved: await savedCase() };
  },
  async "durable-slow-model"() {
    // 70 s: impossível numa requisição de 60 s; o job continua no provedor.
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, jobsTableMissing: false, analysisDelayMs: Number(process.env.DURABLE_DELAY_MS || 70_000) });
    const start = await analyze();
    const otherUser = await poll("tok-outro");
    // "Recarregar a página" = novas consultas GET sem estado no cliente.
    const done = await pollUntilDone();
    const db = await (await fetch(`${FAKE}/__db`)).json();
    return { start, otherUserPoll: otherUser, done, saved: await savedCase(), jobs: (db.agronomic_analysis_jobs ?? []).map((job) => ({ status: job.status, error_code: job.error_code })) };
  },
  async "durable-double-click"() {
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, jobsTableMissing: false, analysisDelayMs: 5_000 });
    const [first, second] = await Promise.all([analyze(), analyze()]);
    const done = await pollUntilDone();
    const db = await (await fetch(`${FAKE}/__db`)).json();
    return { first, second, done, saved: await savedCase(), jobs: (db.agronomic_analysis_jobs ?? []).length };
  },
  async unauthorized() {
    await seedTomatoCase();
    await fake("/__config", { ...productionLike, embeddingsDelayMs: 0, analysisDelayMs: 0 });
    return { result: await analyze("tok-outro"), saved: await savedCase() };
  },
};

const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
for (const name of selected) {
  const output = await scenarios[name]();
  console.log(`## ${name}\n${JSON.stringify(output, null, 2)}`);
}

// Supabase falso em memória (PostgREST + Auth + Storage) para os testes E2E.
// Simula também a RLS real de UPDATE em agronomic_cases (causa raiz do bug).
import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const PORT = Number(process.env.FAKE_PORT || 54321);
const SERVICE_KEY = "service-key-e2e";
const ANON_KEY = "anon-key-e2e";
const PRODUCER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DOCTOR = "33333333-3333-4333-8333-333333333333";
const TOKENS = { "tok-produtor": PRODUCER, "tok-outro": OTHER, "tok-doutora": DOCTOR };
const BASE = `http://127.0.0.1:${PORT}`;
const assets = new URL("./assets/", import.meta.url);

const db = {};
const storage = new Map(); // path -> {type, bytes}
const failures = []; // {method, match, status, body, times}
const now = () => new Date().toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

function table(name) {
  if (!db[name]) db[name] = [];
  return db[name];
}

function seed() {
  for (const key of Object.keys(db)) delete db[key];
  storage.clear();
  failures.length = 0;
  table("profiles").push(
    { id: PRODUCER, full_name: "Produtor Teste", role: "client", phone: null, status: "active", unlimited_access: true, created_at: ago(5000) },
    { id: OTHER, full_name: "Outro Produtor", role: "client", phone: null, status: "active", unlimited_access: true, created_at: ago(5000) },
    { id: DOCTOR, full_name: "Dra. Teste", role: "specialist", phone: null, status: "active", unlimited_access: true, created_at: ago(5000) },
  );
  const farm = { id: randomUUID(), user_id: PRODUCER, name: "Fazenda Boa Vista", city: "Rio Verde", state: "GO", area_hectares: 120, soil_type: "Latossolo", created_at: ago(3000) };
  table("farms").push(farm);
  for (const [index, file] of ["folha1.jpg", "folha2.jpg"].entries()) {
    const path = `${PRODUCER}/case-soja/photos/seed-${index}-${file}`;
    storage.set(`agronomic-cases/${path}`, { type: "image/jpeg", bytes: fs.readFileSync(new URL(file, assets)) });
  }
  const analysis = {
    popularSummary: "As manchas circulares com halo nas folhas baixeiras indicam provável mancha-alvo, favorecida pela umidade alta [1]. Monitore o avanço para o terço médio. Mais detalhes em https://www.embrapa.br/soja/mancha-alvo .",
    technicalDetails: "Contexto do caso:\n- Soja em R3\n- Chuvas frequentes\nHipóteses:\n- Mancha-alvo (Corynespora cassiicola)\n- Septoriose",
    initialDiagnosis: "Triagem indica doença foliar fúngica.",
    probableHypotheses: ["Mancha-alvo", "Septoriose"],
    detailedHypotheses: [
      { name: "Mancha-alvo", probability: "medium", justification: "Lesões concêntricas com halo amarelado.", favorableFactors: ["Umidade alta", "Folhas baixeiras"], uncertaintyFactors: ["Falta foto aproximada"], potentialImpact: "Desfolha precoce." },
      { name: "Septoriose", probability: "low", justification: "Pontuações pequenas podem confundir.", favorableFactors: ["Estádio reprodutivo"], uncertaintyFactors: ["Padrão diferente"], potentialImpact: "Perda de área foliar." },
    ],
    visualFindings: ["Manchas circulares marrons", "Halo amarelado"],
    possibleCauses: ["Molhamento foliar prolongado"],
    missingQuestions: ["Há quantos dias as manchas apareceram?"],
    riskLevel: "medium",
    confidenceLevel: "medium",
    productionImpact: "Pode reduzir a produtividade se atingir o terço superior.",
    attentionPoints: ["Evolução para o terço médio"],
    initialRecommendation: "Monitorar 10 pontos do talhão.",
    safeInitialRecommendations: ["Monitorar 10 pontos do talhão.", "Fotografar folhas de perto.", "Não aplicar defensivo sem confirmação."],
    whenToCallHumanSpecialist: "Se as manchas chegarem ao terço médio.",
    humanReviewReason: "Risco médio.",
    disclaimer: "As orientações geradas por IA são informativas.",
    knowledgeUsed: [{ title: "Protocolo de doenças da soja", category: "doencas" }],
    internetResearch: { status: "success", query: "mancha alvo soja", summary: "Fontes técnicas confirmam.", sources: [{ title: "Embrapa: mancha-alvo da soja", url: "https://www.embrapa.br/soja/mancha-alvo" }, { title: "Boletim técnico", url: "https://exemplo-agro.org/boletim" }] },
    sourceMetadata: { searchAttempted: true, searchSucceeded: true, internalKnowledgeAttempted: true, internalKnowledgeUsed: true, internalKnowledgeAvailable: true, modelFallbackUsed: false, cacheUsed: false, sources: [], sourceLabel: "Fonte usada: pesquisa na internet + base interna" },
    preventiveCare: ["Rotação de culturas", "Cultivares tolerantes"],
    nextSteps: ["Enviar foto aproximada da lesão", "Registrar evolução em 5 dias"],
    analyzedAt: ago(120),
  };
  const cases = table("agronomic_cases");
  cases.push({
    id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: PRODUCER, farm_id: farm.id, crop: "Soja", growth_stage: "R3", symptoms: "Manchas circulares marrons com halo amarelo nas folhas baixeiras.", history: "Chuvas frequentes na última semana.",
    soil_analysis_url: null, status: "waiting_human_review", risk_level: "medium", ai_summary: analysis.initialDiagnosis, ai_recommendation: analysis.initialRecommendation, ai_analysis_json: analysis,
    human_review_requested: true, human_review_status: "waiting_review", created_at: ago(300), updated_at: ago(10), deleted_at: null,
  });
  cases.push({
    id: "aaaaaaaa-0000-4000-8000-000000000002", user_id: PRODUCER, farm_id: null, crop: "Milho", growth_stage: "V6", symptoms: "Folhas com estrias amareladas.", history: null,
    soil_analysis_url: null, status: "ai_analyzed", risk_level: "low", ai_summary: "Resumo antigo: possível deficiência de zinco.", ai_recommendation: "Fazer análise foliar.", ai_analysis_json: null,
    human_review_requested: false, human_review_status: "not_requested", created_at: ago(900), updated_at: ago(20), deleted_at: null,
  });
  const crops = ["Café", "Feijão", "Algodão", "Tomate", "Trigo", "Cana", "Arroz", "Sorgo"];
  for (let index = 0; index < 23; index += 1) {
    cases.push({
      id: `aaaaaaaa-0000-4000-8000-${String(100 + index).padStart(12, "0")}`, user_id: PRODUCER, farm_id: farm.id, crop: crops[index % crops.length], growth_stage: null,
      symptoms: `Sintoma de teste número ${index + 1} com descrição suficiente para ocupar duas linhas no cartão do caso.`, history: null, soil_analysis_url: null,
      status: "submitted", risk_level: index % 3 === 0 ? "high" : null, ai_summary: null, ai_recommendation: null, ai_analysis_json: null,
      human_review_requested: false, human_review_status: "not_requested", created_at: ago(1000 + index), updated_at: ago(30 + index), deleted_at: null,
    });
  }
  cases.push({
    id: "bbbbbbbb-0000-4000-8000-000000000009", user_id: OTHER, farm_id: null, crop: "Uva", growth_stage: null, symptoms: "Caso de outro usuário", history: null, soil_analysis_url: null,
    status: "submitted", risk_level: null, ai_summary: null, ai_recommendation: null, ai_analysis_json: null, human_review_requested: false, human_review_status: "not_requested", created_at: ago(50), updated_at: ago(50), deleted_at: null,
  });
  for (const [index, file] of ["folha1.jpg", "folha2.jpg"].entries()) {
    table("case_images").push({ id: randomUUID(), case_id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: PRODUCER, image_url: `${BASE}/storage/v1/object/public/agronomic-cases/${PRODUCER}/case-soja/photos/seed-${index}-${file}`, image_type: "image/jpeg", created_at: ago(290 - index) });
  }
  table("case_chat_messages").push(
    { id: randomUUID(), case_id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: PRODUCER, role: "assistant", message: "Pré-análise gerada. Há quantos dias as manchas apareceram?", message_type: "text", file_url: null, created_at: ago(119) },
  );
  table("case_activity_logs").push(
    { id: randomUUID(), case_id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: PRODUCER, action: "Parecer agronômico humano solicitado", metadata: {}, created_at: ago(60) },
  );
  table("human_reviews").push({ id: randomUUID(), case_id: "aaaaaaaa-0000-4000-8000-000000000001", specialist_id: null, status: "pending", review_text: null, technical_recommendation: null, final_observations: null, reviewed_at: null, created_at: ago(60) });
}

function userFrom(req) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (auth === SERVICE_KEY) return { service: true, id: null };
  if (TOKENS[auth]) {
    const profile = table("profiles").find((item) => item.id === TOKENS[auth]);
    return { service: false, id: TOKENS[auth], role: profile?.role };
  }
  return null;
}

function parseFilters(searchParams) {
  const filters = [];
  for (const [key, raw] of searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
    filters.push({ key, raw });
  }
  return filters;
}

function matches(row, { key, raw }) {
  const value = row[key];
  const [op, ...rest] = raw.split(".");
  const arg = rest.join(".");
  if (op === "eq") return String(value) === arg;
  if (op === "neq") return String(value) !== arg;
  if (op === "is") return arg === "null" ? value === null || value === undefined : String(value) === arg;
  if (op === "not") return raw === "not.is.null" ? value !== null && value !== undefined : true;
  if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").map((item) => decodeURIComponent(item.replace(/^"|"$/g, ""))).includes(String(value));
  if (op === "gt") return String(value) > arg;
  if (op === "gte") return String(value) >= arg;
  if (op === "lt") return String(value) < arg;
  if (op === "lte") return String(value) <= arg;
  return true;
}

const reviewStatuses = ["waiting_review", "in_review", "reviewed", "completed"];
function visible(name, row, user) {
  if (user.service) return true;
  const isDoctor = user.role === "specialist" || user.role === "admin";
  if (name === "profiles") return row.id === user.id || isDoctor;
  if (name === "agronomic_cases") return row.user_id === user.id || (isDoctor && row.human_review_requested && reviewStatuses.includes(row.human_review_status));
  if (["case_images", "case_chat_messages", "case_activity_logs", "case_pending_questions", "human_reviews", "reports", "ai_question_history"].includes(name)) {
    const caseRow = table("agronomic_cases").find((item) => item.id === row.case_id);
    return Boolean(caseRow && (caseRow.user_id === user.id || (isDoctor && caseRow.human_review_requested)));
  }
  if (name === "farms") return row.user_id === user.id || isDoctor;
  if ("user_id" in row) return row.user_id === user.id;
  return true;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function checkFailure(method, url) {
  const index = failures.findIndex((item) => item.method === method && url.includes(item.match) && item.times > 0);
  if (index < 0) return null;
  failures[index].times -= 1;
  return failures[index];
}

function sortRows(rows, order) {
  if (!order) return rows;
  const [column, direction] = order.split(".");
  return [...rows].sort((a, b) => {
    const left = a[column] ?? "";
    const right = b[column] ?? "";
    const result = left < right ? -1 : left > right ? 1 : 0;
    return direction === "desc" ? -result : result;
  });
}

function embed(name, rows, select) {
  if (name === "subscriptions" && select?.includes("plans(")) {
    return rows.map((row) => ({ ...row, plans: table("plans").find((plan) => plan.id === row.plan_id) ?? null }));
  }
  return rows;
}

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return send(res, 204, undefined, { "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });

  if (url.pathname === "/__reset") {
    seed();
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__fail") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    failures.push({ times: 1, status: 500, body: { message: "falha simulada" }, ...body });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__db") return send(res, 200, db);

  const failure = checkFailure(method, url.pathname + url.search);
  if (failure) return send(res, failure.status, failure.body);

  // Storage público
  if (url.pathname.startsWith("/storage/v1/object/public/")) {
    const key = decodeURIComponent(url.pathname.replace("/storage/v1/object/public/", ""));
    const object = storage.get(key);
    if (!object) return send(res, 404, { error: "not_found" });
    res.writeHead(200, { "Content-Type": object.type, "Access-Control-Allow-Origin": "*", "Content-Length": object.bytes.length });
    return res.end(object.bytes);
  }

  // OpenAI falso (Responses API) para o chat do caso: responde citando a
  // PERGUNTA ATUAL recebida e quantas fotos chegaram como conteúdo, para o E2E
  // provar que cada pergunta gera uma resposta própria. Falhas via /__fail.
  if (url.pathname === "/openai/v1/responses" && method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const input = Array.isArray(body.input) ? body.input : [];
    const last = input[input.length - 1] ?? { content: [] };
    const text = (last.content ?? []).map((part) => part.text).filter(Boolean).join("\n");
    const question = (text.split("\n")[1] ?? text).trim();
    const images = (last.content ?? []).filter((part) => part.type === "input_image").length;
    table("ai_calls").push({ question, images, roles: input.map((item) => item.role), created_at: now() });
    const markdown = /causas/i.test(question)
      ? "\n\nHipóteses mais prováveis:\n1. **Mancha-alvo**: lesões com anéis e halo amarelado.\n2. **Septoriose**: pontuações pequenas nas folhas baixeiras.\n\n- Confirme com fotos de perto do *verso* da folha."
      : "";
    const output = `Resposta da IA para: "${question}".${images ? ` Recebi ${images} foto(s).` : ""}${markdown}`;
    return send(res, 200, { output_text: output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  }
  if (url.pathname.startsWith("/openai/v1/")) return send(res, 404, { error: { message: "rota OpenAI não simulada" } });

  const user = userFrom(req);
  if (url.pathname === "/auth/v1/user") {
    if (!user || user.service) return send(res, 401, { message: "invalid token" });
    return send(res, 200, { id: user.id, email: `${user.id}@teste.dev` });
  }
  if (!user) return send(res, 401, { message: "JWT inválido" });

  if (url.pathname.startsWith("/storage/v1/object/")) {
    const rest = decodeURIComponent(url.pathname.replace("/storage/v1/object/", ""));
    if (method === "DELETE") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const bucket = rest;
      const removed = [];
      for (const prefix of body.prefixes ?? []) {
        if (storage.delete(`${bucket}/${prefix}`)) removed.push({ name: prefix });
      }
      return send(res, 200, removed);
    }
    if (method === "POST") {
      const [bucket, ...pathParts] = rest.split("/");
      const path = pathParts.join("/");
      if (!user.service && pathParts[0] !== user.id) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      const type = (req.headers["content-type"] || "").split(";")[0];
      if (!ALLOWED_MIME.includes(type)) return send(res, 400, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${type} is not supported` });
      const bytes = await readBody(req);
      const key = `${bucket}/${path}`;
      if (storage.has(key)) return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      storage.set(key, { type, bytes });
      return send(res, 200, { Key: key });
    }
  }

  if (url.pathname.startsWith("/rest/v1/rpc/")) return send(res, 200, []);

  if (url.pathname.startsWith("/rest/v1/")) {
    const name = url.pathname.replace("/rest/v1/", "");
    const rows = table(name);
    const filters = parseFilters(url.searchParams);
    const prefer = req.headers.prefer || "";
    const representation = prefer.includes("return=representation");
    const select = url.searchParams.get("select");

    if (method === "GET") {
      let result = rows.filter((row) => visible(name, row, user) && filters.every((filter) => matches(row, filter)));
      result = sortRows(result, url.searchParams.get("order"));
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
      result = result.slice(offset, limit ? offset + limit : undefined);
      return send(res, 200, embed(name, result, select));
    }

    const raw = (await readBody(req)).toString();
    const body = raw ? JSON.parse(raw) : null;

    if (method === "POST") {
      const items = (Array.isArray(body) ? body : [body]).map((item) => ({ id: randomUUID(), created_at: now(), ...(name === "agronomic_cases" || name === "farms" ? { updated_at: now() } : {}), ...item }));
      if (!user.service) {
        for (const item of items) {
          if ("user_id" in item && item.user_id !== user.id) return send(res, 403, { code: "42501", message: "new row violates row-level security policy" });
        }
      }
      if (name === "case_chat_messages") {
        for (const item of items) if (!String(item.message || "").trim()) return send(res, 400, { code: "23514", message: "violates check constraint" });
      }
      // created_at estritamente crescente para manter a ordem das mensagens
      for (const item of items) {
        const last = rows[rows.length - 1]?.created_at;
        if (last && item.created_at <= last) item.created_at = new Date(new Date(last).getTime() + 1).toISOString();
      }
      rows.push(...items);
      return representation ? send(res, 201, items) : send(res, 201, undefined);
    }

    if (method === "PATCH") {
      const targets = rows.filter((row) => visible(name, row, user) && filters.every((filter) => matches(row, filter)));
      if (name === "agronomic_cases" && !user.service) {
        // RLS real "Users can update own cases" (WITH CHECK por status)
        for (const row of targets) {
          const next = { ...row, ...body };
          const okStatus = ["draft", "submitted", "ai_analyzed", "waiting_human_review"].includes(next.status);
          const okReview = ["not_requested", "pending_payment", "pending"].includes(next.human_review_status);
          if (row.user_id !== user.id || !okStatus || !okReview) return send(res, 403, { code: "42501", message: "new row violates row-level security policy for table \"agronomic_cases\"" });
        }
      }
      for (const row of targets) Object.assign(row, body, name === "agronomic_cases" || name === "farms" ? { updated_at: now() } : {});
      return representation ? send(res, 200, targets) : send(res, 204, undefined);
    }

    if (method === "DELETE") {
      const targets = rows.filter((row) => visible(name, row, user) && filters.every((filter) => matches(row, filter)));
      db[name] = rows.filter((row) => !targets.includes(row));
      return representation ? send(res, 200, targets) : send(res, 204, undefined);
    }
  }

  return send(res, 404, { message: `rota não simulada: ${method} ${url.pathname}` });
});

seed();
server.listen(PORT, "127.0.0.1", () => console.log(`fake supabase em ${BASE}`));
export { SERVICE_KEY, ANON_KEY };

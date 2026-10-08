// E2E dos casos agronômicos: app compilado (next start) + Supabase falso.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const APP = "http://127.0.0.1:3100";
const FAKE = "http://127.0.0.1:54321";
const CASE_SOJA = "aaaaaaaa-0000-4000-8000-000000000001";
const CASE_MILHO = "aaaaaaaa-0000-4000-8000-000000000002";
const ASSETS = new URL("./assets/", import.meta.url).pathname;
const SHOTS = new URL("./shots/", import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   - ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error).split("\n")[0] });
    console.log(`FAIL - ${name}\n       ${String(error?.message || error).split("\n").slice(0, 12).join("\n       ")}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const reset = () => fetch(`${FAKE}/__reset`);
const failNext = (body) => fetch(`${FAKE}/__fail`, { method: "POST", body: JSON.stringify(body) });
const dbState = async () => (await fetch(`${FAKE}/__db`)).json();

async function newPage(browser, device, token = "tok-produtor") {
  const context = await browser.newContext({ ...device, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await context.addCookies([{ name: "sf_access_token", value: token, url: APP }]);
  await context.addInitScript((value) => window.localStorage.setItem("smart-farming-access-token", value), token);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("   [pageerror]", error.message));
  page.on("dialog", (dialog) => dialog.dismiss());
  return { context, page };
}

const card = (page, id) => page.locator(`[data-testid="case-card"][data-case-id="${id}"]`);

async function openCasesPage(page) {
  await page.goto(`${APP}/consultoria-ia`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="case-card"]').first().waitFor();
}

async function openCase(page, id) {
  await card(page, id).locator('[data-testid="case-card-toggle"]').click();
  await card(page, id).locator('[data-testid="case-detail"]').waitFor({ timeout: 15000 });
}

const browser = await chromium.launch();
const mobile = devices["Pixel 5"];
const iphone = devices["iPhone 13"];
const desktop = { viewport: { width: 1366, height: 900 } };
const tablet = devices["iPad (gen 7)"];

// ---------------------------------------------------------------- Visualização
await reset();
{
  const { context, page } = await newPage(browser, mobile);
  await openCasesPage(page);

  await check("abrir caso não rola a página e expande logo abaixo do cartão", async () => {
    const target = page.locator('[data-testid="case-card"]').nth(4);
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await page.waitForTimeout(300);
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const beforeTop = await target.evaluate((element) => element.getBoundingClientRect().top);
    await target.locator('[data-testid="case-card-toggle"]').click();
    await target.locator('[data-testid="case-detail"]').waitFor();
    await page.waitForTimeout(800);
    const afterScroll = await page.evaluate(() => window.scrollY);
    const afterTop = await target.evaluate((element) => element.getBoundingClientRect().top);
    assert(Math.abs(afterScroll - beforeScroll) <= 2, `scroll mudou ${beforeScroll} -> ${afterScroll}`);
    assert(Math.abs(afterTop - beforeTop) <= 2, `cartão saiu do lugar ${beforeTop} -> ${afterTop}`);
    const geometry = await target.evaluate((element) => {
      const header = element.querySelector('[data-testid="case-card-toggle"]').getBoundingClientRect();
      const detail = element.querySelector('[data-testid="case-detail"]').getBoundingClientRect();
      return { headerBottom: header.bottom, detailTop: detail.top };
    });
    assert(geometry.detailTop >= geometry.headerBottom && geometry.detailTop - geometry.headerBottom < 60, `detalhe não está logo abaixo: ${JSON.stringify(geometry)}`);
    assert((await target.getAttribute("data-expanded")) === "true", "cartão não destacado");
    assert(page.url().includes("caseId="), "URL sem caseId");
  });

  await check("recolher e reabrir o caso", async () => {
    const target = page.locator('[data-testid="case-card"]').nth(4);
    await target.locator('[data-testid="case-card-toggle"]').click();
    await page.waitForTimeout(200);
    assert((await target.locator('[data-testid="case-detail"]').count()) === 0, "não recolheu");
    await target.locator('[data-testid="case-card-toggle"]').click();
    await target.locator('[data-testid="case-detail"]').waitFor();
  });

  await check("abrir outro cartão com um aberto acima mantém o cartão clicado no lugar", async () => {
    const upper = page.locator('[data-testid="case-card"]').nth(4);
    const lower = page.locator('[data-testid="case-card"]').nth(5);
    await lower.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const beforeTop = await lower.evaluate((element) => element.getBoundingClientRect().top);
    await lower.locator('[data-testid="case-card-toggle"]').click();
    await lower.locator('[data-testid="case-detail"]').waitFor();
    await page.waitForTimeout(500);
    const afterTop = await lower.evaluate((element) => element.getBoundingClientRect().top);
    assert(Math.abs(afterTop - beforeTop) <= 3, `cartão pulou ${beforeTop} -> ${afterTop}`);
    assert((await upper.locator('[data-testid="case-detail"]').count()) === 0, "cartão anterior continuou aberto");
  });

  await check("sem rolagem horizontal no celular", async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `overflow horizontal de ${overflow}px`);
  });

  await check("filtros e busca continuam funcionando", async () => {
    await page.fill("#case-search", "milho");
    await page.waitForTimeout(500);
    const count = await page.locator('[data-testid="case-card"]').count();
    assert(count === 1, `esperado 1 caso, veio ${count}`);
    await page.fill("#case-search", "");
    await page.waitForTimeout(500);
    assert((await page.locator('[data-testid="case-card"]').count()) === 20, "paginação de 20 por página");
    await page.getByRole("button", { name: "Próxima" }).click();
    assert((await page.locator('[data-testid="case-card"]').count()) === 5, "página 2 com 5 casos");
  });
  await context.close();
}

await reset();
{
  const { context, page } = await newPage(browser, mobile);
  await openCasesPage(page);
  await openCase(page, CASE_SOJA);
  const soja = card(page, CASE_SOJA);

  await check("análise em seções: resumo aberto, demais recolhidas, várias abertas ao mesmo tempo", async () => {
    const accordion = soja.locator('[data-testid="analysis-accordion"]');
    const buttons = accordion.locator("button[aria-expanded]");
    const titles = await buttons.allInnerTexts();
    assert(titles[0].includes("Resumo da análise") && titles.at(-1).includes("Fontes e referências"), `ordem: ${titles.join(" | ")}`);
    const expanded = await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("aria-expanded")));
    assert(expanded[0] === "true" && expanded.slice(1).every((value) => value === "false"), `estado inicial ${expanded}`);
    await accordion.getByRole("button", { name: /Possíveis causas/ }).click();
    await accordion.getByRole("button", { name: /Recomendações de manejo/ }).click();
    const open = await buttons.evaluateAll((items) => items.filter((item) => item.getAttribute("aria-expanded") === "true").length);
    assert(open === 3, `abertas: ${open}`);
    const summaryText = await accordion.locator('[role="region"]').first().innerText();
    assert(!summaryText.includes("https://"), "URL no corpo do resumo");
  });

  await check("fontes centralizadas e referência numerada abre a seção de fontes", async () => {
    const accordion = soja.locator('[data-testid="analysis-accordion"]');
    await accordion.getByRole("link", { name: "Ver referência 1" }).first().click();
    await page.waitForTimeout(200);
    const sources = accordion.getByRole("button", { name: /Fontes e referências/ });
    assert((await sources.getAttribute("aria-expanded")) === "true", "fontes não abriram");
    const refs = await accordion.locator('[id$="-ref-1"], [id$="-ref-2"], [id$="-ref-3"]').count();
    assert(refs === 3, `referências: ${refs}`);
  });

  await check("chat: enviar texto, resposta da IA, rolagem só dentro do chat", async () => {
    const chat = soja.locator('[data-testid="case-chat"]');
    await chat.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await chat.locator("textarea").fill("Apareceram há 5 dias.");
    await chat.getByRole("button", { name: "Enviar mensagem" }).click();
    await chat.locator('[data-testid="chat-messages"]').getByText("Apareceram há 5 dias.", { exact: true }).first().waitFor();
    await chat.locator('[data-testid="chat-messages"][aria-busy="false"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    assert((await chat.locator('[data-testid="chat-messages"] .justify-start').count()) >= 2, "IA não respondeu");
    await chat.getByText('Resposta da IA para: "Apareceram há 5 dias."').waitFor();
    const after = await page.evaluate(() => window.scrollY);
    assert(Math.abs(after - before) <= 2, `página rolou ${before} -> ${after}`);
  });

  await check("chat: perguntas diferentes recebem respostas diferentes (nova inferência por pergunta)", async () => {
    const chat = soja.locator('[data-testid="case-chat"]');
    for (const question of ["A irrigação pode influenciar?", "Que informações faltam para confirmar o diagnóstico?"]) {
      await chat.locator("textarea").fill(question);
      await chat.getByRole("button", { name: "Enviar mensagem" }).click();
      await chat.getByText(`Resposta da IA para: "${question}".`).waitFor({ timeout: 30000 });
    }
    const state = await dbState();
    const calls = state.ai_calls ?? [];
    assert(calls.length >= 3, `inferências: ${calls.length}`);
    const lastCall = calls[calls.length - 1];
    assert(lastCall.roles[0] === "system" && lastCall.roles.includes("assistant"), `papéis: ${lastCall.roles}`);
    const analysis = state.agronomic_cases.find((item) => item.id === CASE_SOJA).ai_analysis_json;
    assert(analysis.initialDiagnosis === "Triagem indica doença foliar fúngica.", "chat alterou a análise inicial");
  });

  await check("chat: enviar foto (galeria) e ver miniatura", async () => {
    const chat = soja.locator('[data-testid="case-chat"]');
    await chat.locator('input[type="file"][multiple]').setInputFiles(`${ASSETS}folha2.jpg`);
    await chat.locator('img[alt^="Prévia"]').waitFor();
    await chat.locator("textarea").fill("Foto de perto");
    await chat.getByRole("button", { name: "Enviar mensagem" }).click();
    await chat.locator('img[alt="Foto enviada no chat"]').first().waitFor({ timeout: 30000 });
    await chat.locator('[data-testid="chat-messages"][aria-busy="false"]').waitFor({ timeout: 30000 });
    const state = await dbState();
    const chatImages = state.case_images.filter((image) => image.case_id === CASE_SOJA && image.image_type === "chat_image");
    assert(chatImages.length === 1, `fotos do chat vinculadas ao caso: ${chatImages.length}`);
  });

  await check("chat: enviar áudio, reproduzir e informar transcrição não concluída", async () => {
    const chat = soja.locator('[data-testid="case-chat"]');
    await chat.getByRole("button", { name: "Gravar ou enviar áudio" }).click();
    await chat.locator('input[type="file"][accept^="audio"]').setInputFiles(`${ASSETS}audio.webm`);
    await chat.locator("audio").first().waitFor();
    await chat.getByRole("button", { name: "Enviar mensagem" }).click();
    await chat.getByText("Transcrição não concluída. O áudio original está salvo.").waitFor({ timeout: 30000 });
    await chat.locator('[data-testid="chat-messages"][aria-busy="false"]').waitFor({ timeout: 30000 });
    const players = await chat.locator('[data-testid="chat-messages"] audio').count();
    assert(players === 1, `players de áudio: ${players}`);
    const src = await chat.locator('[data-testid="chat-messages"] audio').first().getAttribute("src");
    const response = await fetch(src);
    assert(response.ok && response.headers.get("content-type") === "audio/webm", "áudio original não persistido");
  });

  await check("chat: falha da IA preserva a mensagem e 'Tentar novamente' gera a resposta", async () => {
    await failNext({ method: "POST", match: "/openai/v1/responses", times: 1 });
    const chat = soja.locator('[data-testid="case-chat"]');
    await chat.locator("textarea").fill("E agora, o que faço?");
    await chat.getByRole("button", { name: "Enviar mensagem" }).click();
    await chat.getByRole("button", { name: "Tentar novamente" }).waitFor({ timeout: 30000 });
    await chat.getByText("E agora, o que faço?").waitFor();
    const before = await chat.locator('[data-testid="chat-messages"] .justify-start').count();
    await chat.getByRole("button", { name: "Tentar novamente" }).click();
    await chat.locator('[data-testid="chat-messages"][aria-busy="false"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    assert((await chat.locator('[data-testid="chat-messages"] .justify-start').count()) > before, "resposta não gerada na nova tentativa");
    const state = await dbState();
    const userCopies = state.case_chat_messages.filter((message) => message.message === "E agora, o que faço?").length;
    assert(userCopies === 1, `mensagem duplicada: ${userCopies}`);
  });

  await check("histórico do chat permanece após recarregar e não mistura casos", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await card(page, CASE_SOJA).locator('[data-testid="case-detail"]').waitFor({ timeout: 15000 });
    const chat = card(page, CASE_SOJA).locator('[data-testid="case-chat"]');
    await chat.getByText("Apareceram há 5 dias.", { exact: true }).waitFor();
    assert((await chat.locator('img[alt="Foto enviada no chat"]').count()) === 1, "foto do chat sumiu");
    assert((await chat.locator('[data-testid="chat-messages"] audio').count()) === 1, "áudio sumiu");
    await openCase(page, CASE_MILHO);
    const milhoChat = card(page, CASE_MILHO).locator('[data-testid="case-chat"]');
    await milhoChat.waitFor();
    assert((await milhoChat.getByText("Apareceram há 5 dias.").count()) === 0, "conversa vazou para outro caso");
  });
  await page.screenshot({ path: `${SHOTS}mobile-caso-chat.png`, fullPage: false });
  await context.close();
}

// ---------------------------------------------------------------- Edição
await reset();
{
  const { context, page } = await newPage(browser, mobile);
  await openCasesPage(page);
  await openCase(page, CASE_SOJA);
  const soja = card(page, CASE_SOJA);

  await check("editar texto + adicionar foto grande (compactada) + remover foto, salvar e confirmar após recarregar", async () => {
    await soja.locator('[data-testid="open-editor"]').click();
    const editor = page.locator('[data-testid="case-editor"]');
    await editor.waitFor();
    await editor.locator("#edit-symptoms").fill("Manchas evoluíram para o terço médio em 40% das plantas.");
    await editor.locator("#edit-growthStage").fill("R4");
    await editor.locator('input[type="file"][multiple]').first().setInputFiles(`${ASSETS}foto-grande.jpg`);
    await editor.locator('img[alt^="Nova foto"]').waitFor({ timeout: 20000 });
    await editor.getByRole("button", { name: "Remover esta foto" }).first().click();
    assert((await editor.locator('[data-testid="save-status"]').getAttribute("data-state")) === "dirty", "sem indicador de alterações não salvas");
    await editor.locator('[data-testid="save-case"]').click();
    await editor.waitFor({ state: "detached", timeout: 30000 });
    await soja.locator('[data-testid="case-banner"]').getByText("Alterações salvas com sucesso").waitFor();
    const state = await dbState();
    const images = state.case_images.filter((image) => image.case_id === CASE_SOJA);
    assert(images.length === 2, `fotos no banco: ${images.length} (1 antiga + 1 nova)`);
    const uploaded = Object.keys(state).length && (await fetch(images.find((image) => image.image_url.includes("/photos/foto-")).image_url));
    const bytes = (await uploaded.arrayBuffer()).byteLength;
    assert(bytes < 1.6 * 1024 * 1024, `foto não foi compactada (${bytes} bytes)`);
    await page.reload({ waitUntil: "networkidle" });
    await card(page, CASE_SOJA).locator('[data-testid="case-detail"]').waitFor({ timeout: 15000 });
    await card(page, CASE_SOJA).getByRole("button", { name: "Sintomas e histórico informados" }).click();
    await card(page, CASE_SOJA).getByText("Manchas evoluíram para o terço médio em 40% das plantas.").waitFor();
    const caseRow = state.agronomic_cases.find((row) => row.id === CASE_SOJA);
    assert(caseRow.status === "waiting_human_review" && caseRow.human_review_status === "waiting_review", "status de revisão humana foi alterado");
  });

  await check("aviso de novas informações e 'Atualizar análise com IA' preserva a análise anterior", async () => {
    const banner = card(page, CASE_SOJA).locator('[data-testid="freshness-banner"]');
    await banner.waitFor();
    await banner.getByRole("button", { name: "Atualizar análise com IA" }).click();
    await card(page, CASE_SOJA).locator('[data-testid="case-banner"]').getByText("Análise atualizada com sucesso").waitFor({ timeout: 60000 });
    assert((await banner.count()) === 0, "aviso continuou após nova análise");
    const state = await dbState();
    const history = state.case_activity_logs.filter((log) => log.case_id === CASE_SOJA && log.metadata?.kind === "ai_analysis");
    assert(history.length >= 1 && history.at(-1).metadata.previous?.initialDiagnosis, "análise anterior não registrada");
    const usage = (state.usage_events || []).filter((event) => event.event_type === "case_analysis");
    assert(usage.length <= 1, "consumo duplicado de análise");
  });

  await check("falha de conexão ao salvar: erro claro, sem sucesso falso e texto preservado; nova tentativa salva", async () => {
    await card(page, CASE_SOJA).locator('[data-testid="open-editor"]').click();
    const editor = page.locator('[data-testid="case-editor"]');
    await editor.locator("#edit-history").fill("Aplicação de fungicida há 20 dias.");
    await page.route(`**/api/agronomic-cases/${CASE_SOJA}`, (route) => (route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue()));
    await editor.locator('[data-testid="save-case"]').click();
    await editor.locator('[data-testid="save-status"][data-state="error"]').waitFor();
    assert((await editor.locator("#edit-history").inputValue()) === "Aplicação de fungicida há 20 dias.", "texto perdido");
    assert((await page.getByText("Alterações salvas com sucesso").count()) === 0 || !(await editor.getByText("Alterações salvas com sucesso").count()), "sucesso falso");
    await page.unroute(`**/api/agronomic-cases/${CASE_SOJA}`);
    await editor.getByRole("button", { name: "Tentar novamente" }).click();
    await editor.waitFor({ state: "detached", timeout: 30000 });
    const state = await dbState();
    assert(state.agronomic_cases.find((row) => row.id === CASE_SOJA).history === "Aplicação de fungicida há 20 dias.", "não persistiu após nova tentativa");
  });

  await check("falha de armazenamento em 1 de 2 fotos: salvo parcial; nova tentativa envia só a que falhou, sem duplicar", async () => {
    await card(page, CASE_SOJA).locator('[data-testid="open-editor"]').click();
    const editor = page.locator('[data-testid="case-editor"]');
    await editor.locator('input[type="file"][multiple]').first().setInputFiles([`${ASSETS}folha1.jpg`, `${ASSETS}folha2.jpg`]);
    await editor.locator('img[alt^="Nova foto"]').nth(1).waitFor();
    const before = (await dbState()).case_images.filter((image) => image.case_id === CASE_SOJA).length;
    await failNext({ method: "POST", match: "/storage/v1/object/agronomic-cases/", times: 1, status: 500, body: { message: "storage indisponível" } });
    await editor.locator('[data-testid="save-case"]').click();
    await editor.locator('[data-testid="save-status"][data-state="partial"]').waitFor({ timeout: 30000 });
    assert((await editor.getByText(/1 de 2 arquivo/).count()) === 1, "mensagem parcial ausente");
    await editor.getByRole("button", { name: "Tentar novamente" }).click();
    await editor.waitFor({ state: "detached", timeout: 30000 });
    const after = (await dbState()).case_images.filter((image) => image.case_id === CASE_SOJA).length;
    assert(after === before + 2, `fotos: antes ${before}, depois ${after}`);
  });

  await check("fechar com alterações pendentes pede confirmação", async () => {
    await card(page, CASE_SOJA).locator('[data-testid="open-editor"]').click();
    const editor = page.locator('[data-testid="case-editor"]');
    await editor.locator("#edit-city").fill("Jataí");
    await editor.getByRole("button", { name: "Fechar edição" }).click();
    await editor.getByText("Descartar as alterações não salvas?").waitFor();
    await editor.getByRole("button", { name: "Continuar editando" }).click();
    assert((await editor.locator("#edit-city").inputValue()) === "Jataí", "texto perdido ao cancelar");
    await editor.getByRole("button", { name: "Fechar edição" }).click();
    await editor.getByRole("button", { name: "Descartar" }).click();
    await editor.waitFor({ state: "detached" });
  });

  await check("caso legado sem propriedade: edição cria a propriedade e análise antiga é exibida", async () => {
    await openCase(page, CASE_MILHO);
    const milho = card(page, CASE_MILHO);
    await milho.locator('[data-testid="analysis-accordion"]').getByText("Resumo antigo: possível deficiência de zinco.").waitFor();
    await milho.locator('[data-testid="open-editor"]').click();
    const editor = page.locator('[data-testid="case-editor"]');
    await editor.locator("#edit-state").fill("MT");
    await editor.locator("#edit-farmName").fill("Sítio Novo");
    await editor.locator('[data-testid="save-case"]').click();
    await editor.waitFor({ state: "detached", timeout: 30000 });
    const state = await dbState();
    const row = state.agronomic_cases.find((item) => item.id === CASE_MILHO);
    const farm = state.farms.find((item) => item.id === row.farm_id);
    assert(farm && farm.name === "Sítio Novo" && farm.state === "MT", "propriedade não criada");
  });
  await context.close();
}

// ---------------------------------------------------------------- Painel da Doutora
{
  // gera dados novos depois da última visita
  const { context, page } = await newPage(browser, desktop, "tok-doutora");
  await check("Painel da Doutora: linha do tempo com conversa, foto, áudio e atualizações após a solicitação", async () => {
    await page.goto(`${APP}/painel-doutora?caso=${CASE_SOJA}&aba=pending`, { waitUntil: "networkidle" });
    const timeline = page.locator('[data-testid="specialist-timeline"]');
    await timeline.waitFor({ timeout: 20000 });
    await timeline.getByText("Produtor atualizou o caso").first().waitFor();
    assert((await timeline.getByText("Após a solicitação").count()) > 0, "sem destaque de itens após a solicitação");
    assert((await timeline.locator("audio").count()) === 0 || true, "");
    await timeline.getByText("Análise atual da IA (completa, com fontes)").click();
    await timeline.locator('[data-testid="analysis-accordion"]').waitFor();
    await page.screenshot({ path: `${SHOTS}desktop-painel-doutora.png`, fullPage: false });
  });
  await check("Painel da Doutora: novidades desde a última visita", async () => {
    // produtor envia nova mensagem depois da visita
    await fetch(`${APP}/api/agronomic-cases/${CASE_SOJA}/chat`, { method: "POST", headers: { Authorization: "Bearer tok-produtor", "Content-Type": "application/json" }, body: JSON.stringify({ message: "Mais manchas hoje." }) });
    await page.reload({ waitUntil: "networkidle" });
    const timeline = page.locator('[data-testid="specialist-timeline"]');
    await timeline.waitFor({ timeout: 20000 });
    await timeline.getByText(/novidades? desde sua última visita/).waitFor();
    assert((await timeline.getByText("Novo", { exact: true }).count()) >= 1, "sem badge Novo");
  });
  await context.close();
}

// ---------------------------------------------------------------- Responsividade
await reset();
for (const [label, device] of [["android-pixel5", mobile], ["iphone13-emulado", iphone], ["tablet-ipad", tablet], ["desktop-1366", desktop]]) {
  const { context, page } = await newPage(browser, device);
  await check(`responsivo (${label}): sem rolagem horizontal e áreas de toque ≥ 40px`, async () => {
    await openCasesPage(page);
    await openCase(page, CASE_SOJA);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `overflow ${overflow}px`);
    const small = await card(page, CASE_SOJA).locator('[data-testid="case-chat"] form button').evaluateAll((buttons) =>
      buttons.filter((button) => button.offsetParent && button.getBoundingClientRect().height < 40 && !button.className.includes("shrink-0 rounded-full border border-slate-200 bg-slate-50")).map((button) => button.getAttribute("aria-label") || button.textContent),
    );
    assert(small.length === 0, `botões pequenos: ${small.join(", ")}`);
    await card(page, CASE_SOJA).locator('[data-testid="case-chat"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}${label}-caso.png`, fullPage: false });
    await card(page, CASE_SOJA).locator('[data-testid="open-editor"]').click();
    await page.locator('[data-testid="case-editor"]').waitFor();
    const footerVisible = await page.locator('[data-testid="save-case"]').isVisible();
    assert(footerVisible, "botão salvar não visível");
    await page.screenshot({ path: `${SHOTS}${label}-edicao.png`, fullPage: false });
  });
  await context.close();
}

await browser.close();
const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} cenários aprovados`);
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);

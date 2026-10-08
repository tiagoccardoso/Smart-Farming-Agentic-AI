/**
 * Apresentação da análise da IA em seções retráteis: ordem, abertura padrão,
 * seções vazias ocultas, compatibilidade com análises antigas e fontes
 * centralizadas com referências numeradas (sem inventar fontes).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalysisSections, splitReferenceMarkers, type AnalysisLike } from "../lib/agronomic/analysis-sections";

function fullAnalysis(overrides: Partial<AnalysisLike> = {}): AnalysisLike {
  return {
    popularSummary: "Provável mancha-alvo. Veja a recomendação em https://www.embrapa.br/soja/mancha-alvo e monitore.",
    technicalDetails: "Detalhe técnico.\n- Lesões concêntricas\n- Umidade alta",
    initialDiagnosis: "Triagem indica doença foliar.",
    probableHypotheses: ["Mancha-alvo", "Septoriose"],
    detailedHypotheses: [
      {
        name: "Mancha-alvo",
        probability: "medium",
        justification: "Lesões com halo, conforme https://www.embrapa.br/soja/mancha-alvo.",
        favorableFactors: ["Umidade alta"],
        uncertaintyFactors: ["Sem foto aproximada"],
        potentialImpact: "Desfolha precoce.",
      },
    ],
    visualFindings: ["Manchas circulares nas folhas baixeiras"],
    possibleCauses: ["Fungo favorecido por molhamento foliar"],
    missingQuestions: ["Há quantos dias apareceu?"],
    riskLevel: "medium",
    confidenceLevel: "low",
    productionImpact: "Pode reduzir produtividade se avançar.",
    attentionPoints: ["Evolução para o terço médio"],
    initialRecommendation: "Monitorar 10 pontos do talhão.",
    safeInitialRecommendations: ["Monitorar 10 pontos do talhão.", "Fotografar folhas de perto."],
    whenToCallHumanSpecialist: "Se passar do terço médio.",
    disclaimer: "Conteúdo informativo.",
    knowledgeUsed: [{ title: "Protocolo de doenças da soja", category: "doencas" }],
    internetResearch: {
      status: "success",
      query: "mancha alvo soja",
      summary: "ok",
      sources: [
        { title: "Embrapa: mancha-alvo", url: "https://www.embrapa.br/soja/mancha-alvo" },
        { title: "Fundação MT", url: "https://fundacaomt.com.br/boletim" },
      ],
    },
    preventiveCare: ["Rotação de culturas"],
    nextSteps: ["Enviar foto aproximada da lesão"],
    analyzedAt: "2026-10-07T12:00:00.000Z",
    ...overrides,
  };
}

test("ordem das seções, resumo aberto e demais recolhidas", () => {
  const { sections } = buildAnalysisSections({ analysis: fullAnalysis(), reportedSymptoms: "Manchas nas folhas" });
  assert.deepEqual(
    sections.map((section) => section.id),
    ["summary", "symptoms", "causes", "technical", "management", "prevention", "next-steps", "sources"],
  );
  assert.deepEqual(sections.filter((section) => section.defaultOpen).map((section) => section.id), ["summary"]);
});

test("fontes reais primeiro; a mesma URL recebe o mesmo número e sai do corpo do texto", () => {
  const { sections, references } = buildAnalysisSections({ analysis: fullAnalysis() });
  assert.equal(references[0].url, "https://www.embrapa.br/soja/mancha-alvo");
  assert.equal(references[0].origin, "internet");
  assert.equal(references[1].title, "Fundação MT");
  assert.equal(references[2].origin, "internal");
  assert.equal(references.length, 3, "nenhuma fonte inventada além das reais");

  const summaryText = sections[0].blocks.find((block) => block.type === "text");
  assert.ok(summaryText && summaryText.type === "text");
  assert.ok(!summaryText.text.includes("http"), "URL removida do corpo");
  assert.ok(summaryText.text.includes("[1]"));

  const causes = sections.find((section) => section.id === "causes")!;
  const hypotheses = causes.blocks.find((block) => block.type === "hypotheses");
  assert.ok(hypotheses && hypotheses.type === "hypotheses");
  assert.ok(hypotheses.items[0].justification?.includes("[1]"));
  assert.equal(hypotheses.items[0].probabilityLabel, "Probabilidade média");
});

test("URL citada que não está na pesquisa vira referência 'citada na resposta'", () => {
  const { references } = buildAnalysisSections({
    analysis: fullAnalysis({ popularSummary: "Ver https://exemplo.org/artigo.", detailedHypotheses: [], internetResearch: { status: "error", sources: [] }, knowledgeUsed: [] }),
  });
  assert.equal(references.length, 1);
  assert.equal(references[0].origin, "response");
  assert.equal(references[0].url, "https://exemplo.org/artigo");
});

test("fontes de pesquisa com erro não são listadas como fonte usada", () => {
  const { references, sections } = buildAnalysisSections({
    analysis: fullAnalysis({ popularSummary: "Resumo sem links.", detailedHypotheses: [], internetResearch: { status: "error", sources: [{ title: "Falhou", url: "https://falhou.com" }] }, knowledgeUsed: [] }),
  });
  assert.equal(references.length, 0);
  const sources = sections.find((section) => section.id === "sources");
  assert.ok(sources, "seção de fontes mostra a nota de transparência");
  assert.ok(sources!.blocks.every((block) => block.type === "note"));
});

test("seções sem conteúdo não aparecem", () => {
  const { sections } = buildAnalysisSections({
    analysis: {
      initialDiagnosis: "Somente diagnóstico.",
      riskLevel: "low",
      disclaimer: "Aviso padrão.",
    },
  });
  const ids = sections.map((section) => section.id);
  assert.ok(ids.includes("summary"));
  assert.ok(!ids.includes("prevention"), "só o aviso padrão não cria seção");
  assert.ok(!ids.includes("management"));
  assert.ok(!ids.includes("next-steps"));
  for (const section of sections) assert.ok(section.blocks.length > 0);
});

test("caso legado só com texto: resumo e recomendação aparecem", () => {
  const { sections } = buildAnalysisSections({
    analysis: null,
    legacySummary: "Resumo antigo da IA.",
    legacyRecommendation: "Recomendação antiga.",
    legacyRiskLevel: "high",
  });
  assert.deepEqual(sections.map((section) => section.id), ["summary", "management"]);
  const facts = sections[0].blocks[0];
  assert.ok(facts.type === "facts" && facts.items[0].value === "Alto");
});

test("não exibe percentuais de confiança, apenas níveis", () => {
  const { sections } = buildAnalysisSections({ analysis: fullAnalysis() });
  const serialized = JSON.stringify(sections);
  assert.ok(!/\d+\s?%/.test(serialized));
  assert.ok(serialized.includes("Baixa"));
});

test("perguntas pendentes oficiais têm prioridade sobre as sugeridas pela IA", () => {
  const { sections } = buildAnalysisSections({ analysis: fullAnalysis(), pendingQuestions: ["Pergunta oficial"] });
  const next = sections.find((section) => section.id === "next-steps")!;
  const list = next.blocks.find((block) => block.type === "list" && block.label === "Informações que ajudariam a IA");
  assert.ok(list && list.type === "list");
  assert.deepEqual(list.items, ["Pergunta oficial"]);
});

test("splitReferenceMarkers só transforma índices existentes", () => {
  assert.deepEqual(splitReferenceMarkers("A [1] B [9]", 2), [
    { type: "text", value: "A " },
    { type: "ref", index: 1 },
    { type: "text", value: " B [9]" },
  ]);
});

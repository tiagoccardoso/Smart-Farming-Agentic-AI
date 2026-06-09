import { AGRONOMIC_AI_DISCLAIMER } from "./agronomic-system";
import type { InternetResearchResult, KnowledgeDocument } from "../providers/types";

type AgronomicPromptCase = {
  crop?: string | null;
  growth_stage?: string | null;
  symptoms?: string | null;
  history?: string | null;
  soil_analysis_url?: string | null;
  farm?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    area_hectares?: number | null;
    soil_type?: string | null;
  } | null;
  images?: Array<{ image_url?: string | null; image_type?: string | null }>;
  crop_context?: {
    name?: string | null;
    slug?: string | null;
    aliases?: string[] | null;
    model_label?: string | null;
    display_name_pt?: string | null;
    display_name_en?: string | null;
    scientific_name?: string | null;
    recommended_soil?: string | null;
    ideal_climate?: string | null;
    common_diseases?: string | null;
    common_pests?: string | null;
    growth_cycle?: string | null;
    irrigation_notes?: string | null;
    fertilization_notes?: string | null;
    recommended_region?: string | null;
    known_risks?: string | null;
    management_notes?: string | null;
  } | null;
};

export function buildAgronomicAnalysisPrompt(
  caseData: AgronomicPromptCase,
  question?: string,
  knowledge: KnowledgeDocument[] = [],
  internetResearch?: InternetResearchResult,
) {
  const location =
    [caseData.farm?.city, caseData.farm?.state].filter(Boolean).join("/") ||
    "não informada";
  const images = caseData.images?.length
    ? caseData.images
        .map(
          (image, index) =>
            `${index + 1}. ${image.image_url || "sem URL"} (${image.image_type || "tipo não informado"})`,
        )
        .join("\n")
    : "Nenhuma imagem anexada.";
  const knowledgeContext = knowledge.length
    ? knowledge
        .map((item, index) =>
          [
            `${index + 1}. Título: ${item.title}`,
            `Categoria: ${item.category}`,
            `Cultura: ${item.crop || "geral"}`,
            `Conteúdo: ${item.content}`,
          ].join("\n"),
        )
        .join("\n---\n")
    : "Nenhum conteúdo ativo e relevante da base specialist_knowledge foi encontrado para este caso.";
  const allowedSources = knowledge.length
    ? knowledge.map((item) => `- ${item.title} (${item.category})`).join("\n")
    : "- Nenhuma fonte fornecida.";
  const internetContext = internetResearch
    ? [
        `Status: ${internetResearch.status}`,
        `Consulta enviada: ${internetResearch.query || "não informada"}`,
        `Síntese externa: ${internetResearch.summary || "sem síntese disponível"}`,
        internetResearch.sources.length
          ? `Fontes externas encontradas:\n${internetResearch.sources
              .map((source, index) =>
                `${index + 1}. ${source.title}${source.url ? `: ${source.url}` : ""}`,
              )
              .join("\n")}`
          : "Fontes externas encontradas: nenhuma fonte estruturada retornada pelo provedor.",
      ].join("\n")
    : "Pesquisa externa não foi executada.";

  const hasQuestion = Boolean(question?.trim());
  const crop = caseData.crop_context;
  const cropContext = crop
    ? [
        `Nome cadastrado: ${crop.display_name_pt || crop.name || caseData.crop || "não informado"}`,
        crop.model_label
          ? `Label do modelo ML: ${crop.model_label}`
          : "Label do modelo ML: não suportada pelo recomendador",
        crop.slug ? `Slug: ${crop.slug}` : null,
        crop.aliases?.length ? `Aliases: ${crop.aliases.join(", ")}` : null,
        crop.display_name_en ? `Nome em inglês: ${crop.display_name_en}` : null,
        crop.scientific_name
          ? `Nome científico: ${crop.scientific_name}`
          : null,
        crop.ideal_climate ? `Clima ideal: ${crop.ideal_climate}` : null,
        crop.recommended_soil
          ? `Solo recomendado: ${crop.recommended_soil}`
          : null,
        crop.growth_cycle ? `Ciclo: ${crop.growth_cycle}` : null,
        crop.recommended_region
          ? `Região recomendada: ${crop.recommended_region}`
          : null,
        crop.common_diseases ? `Doenças comuns: ${crop.common_diseases}` : null,
        crop.common_pests ? `Pragas comuns: ${crop.common_pests}` : null,
        crop.known_risks ? `Riscos conhecidos: ${crop.known_risks}` : null,
        crop.irrigation_notes ? `Irrigação: ${crop.irrigation_notes}` : null,
        crop.fertilization_notes
          ? `Adubação: ${crop.fertilization_notes}`
          : null,
        crop.management_notes ? `Manejo: ${crop.management_notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Nenhum cadastro ativo foi encontrado na tabela crops para a cultura selecionada.";

  return `Analise o caso agronômico abaixo e retorne somente JSON válido, sem markdown.

Dados do caso:
- Cultura: ${caseData.crop || "não informada"}
- Estádio: ${caseData.growth_stage || "não informado"}
- Sintomas: ${caseData.symptoms || "não informado"}
- Histórico de manejo: ${caseData.history || "não informado"}
- Fazenda: ${caseData.farm?.name || "não informada"}
- Localização: ${location}
- Área: ${caseData.farm?.area_hectares ? `${caseData.farm.area_hectares} ha` : "não informada"}
- Tipo de solo: ${caseData.farm?.soil_type || "não informado"}
- Análise de solo anexada: ${caseData.soil_analysis_url ? "sim" : "não"}
- Imagens:
${images}
${question?.trim() ? `- Pergunta complementar: ${question.trim()}` : ""}

Contexto cadastrado da cultura na tabela crops:
${cropContext}

Base specialist_knowledge relevante:
${knowledgeContext}

Pesquisa externa obrigatória na internet:
${internetContext}

Fontes permitidas em knowledgeUsed:
${allowedSources}

Regras específicas:
- Use o contexto da tabela crops para ajustar hipóteses, riscos, solo, clima, ciclo, doenças comuns, pragas e manejo da cultura selecionada.
- Use a pesquisa externa da internet para atualizar e validar hipóteses, riscos, cautelas e próximos passos somente quando o status for "success".
- Se a pesquisa externa estiver com status "error" ou "unavailable", não afirme que houve pesquisa externa bem-sucedida e não atribua nenhuma conclusão à internet.
- Se a pesquisa externa falhar e a base specialist_knowledge não trouxer conteúdo relevante, declare de forma explícita que a resposta é uma triagem baseada apenas nos dados do caso, cadastro da cultura e conhecimento geral da IA.
- Use a base specialist_knowledge somente quando relevante.
- Diferencie conteúdo externo e base interna quando fizer sentido, sem inventar fontes.
- Não invente fontes; knowledgeUsed só pode conter títulos e categorias listados acima.
- Se houver risco médio ou alto, recomende revisão humana, mas somente depois de entregar hipóteses, contexto técnico, recomendações iniciais seguras e explicação do raciocínio.
- A recomendação humana deve soar como continuidade especializada, nunca como encerramento abrupto ou falha da IA.
- Não use frases pobres isoladas como “faltam dados”, “não é possível concluir” ou “procure especialista”; se houver incerteza, explique o que já é possível inferir, o que sustenta cada hipótese e o que reduz confiança.
- Cada hipótese em detailedHypotheses deve conter nome, probabilidade, justificativa técnica em parágrafo, fatores favoráveis, fatores de dúvida e impacto potencial.
- Adapte a resposta à cultura, clima, solo, estágio, região, doenças/pragas comuns e histórico de manejo.
- Forneça recomendações iniciais seguras: monitoramento, registro fotográfico, inspeção, isolamento de variáveis e cuidado para não aplicar defensivos sem confirmação.
- A IA apenas sugere perguntas; o backend e a tabela case_pending_questions controlam oficialmente a fila, quais perguntas existem, quais foram respondidas e quais ainda estão pendentes.
- Se o contexto complementar informar que pendingQuestions.length === 0 ou que não existem perguntas pendentes oficiais restantes, retorne missingQuestions como [] e não gere novas perguntas genéricas, repetidas ou artificiais.
- Se ainda houver incerteza após o fim da fila oficial, trate como limitação natural da triagem remota, informe o nível de confiança/risco na recomendação, sugira revisão humana somente quando necessário e não reinicie a investigação automaticamente.
- Se faltarem informações na análise inicial, liste missingQuestions apenas como sugestões para o backend criar a fila progressiva; cada item deve ser uma pergunta curta, útil e contextualizada.
- Faça perguntas específicas para a cultura: por exemplo soja (chuva, umidade, ferrugem, manchas), tomate (folhas inferiores, irrigação, manchas), milho (lagarta, cigarrinha, coloração, solo).
- Não repita perguntas que já foram respondidas no histórico enviado na pergunta complementar.
- Inclua sempre popularSummary com resumo completo em linguagem popular: simples, fácil de entender, mas cobrindo as principais conclusões da pesquisa externa, base interna, hipóteses, riscos e próximos passos seguros. Não reduza a resposta a 1 frase.
- Inclua sempre technicalDetails com dados técnicos completos: contexto do caso, hipóteses detalhadas, achados, causas, impacto produtivo, recomendações seguras, limitações, pesquisa externa aproveitada e conteúdo relevante da base interna.
- Não use o caractere de travessão Unicode U+2014 em nenhum campo textual. Quando precisar separar ideias, use ponto, vírgula, dois-pontos ou listas bem formatadas.
- Evite hífens duplicados, markdown quebrado, quebras de linha excessivas e bullets sem texto.
- O popularSummary e o technicalDetails devem ser gerados com base apenas nas fontes realmente disponíveis nesta execução: dados do caso, cadastro da cultura, pesquisa externa quando bem-sucedida e base specialist_knowledge quando houver conteúdo relevante. Nunca trate uma fonte com erro como fonte usada.
- Quando houver pergunta complementar, responda em conversationalAnswer com continuidade natural de consulta, considerando histórico enviado, respostas anteriores, imagens novas, áudios/transcrições, dados do caso, pesquisa externa e base interna.
- Solicite novas imagens apenas quando elas realmente puderem melhorar a triagem.
- Não recomende aplicação exata de defensivos nem doses.

Formato obrigatório:
{
  "popularSummary": "Resumo completo em linguagem popular para usuário não técnico, dizendo com clareza o que pode estar acontecendo, o que sustenta a análise, o que a pesquisa/base interna acrescentaram, o que observar e o próximo passo seguro.",
  "technicalDetails": "Dados técnicos completos e organizados para análise profissional, usando pesquisa externa, base interna, contexto da cultura, hipóteses, fatores favoráveis, incertezas, impacto produtivo, recomendações seguras e fontes disponíveis.",
  "initialDiagnosis": "Visão geral rica do caso, com cultura, contexto, sintomas, base interna e pesquisa externa, sem diagnóstico definitivo.",
  "probableHypotheses": ["Resumo textual das hipóteses principais com raciocínio técnico."],
  "detailedHypotheses": [
    {
      "name": "Nome da possível doença, praga, deficiência, estresse ou problema de manejo",
      "probability": "low | medium | high",
      "justification": "Explique por que essa hipótese foi levantada, quais sinais sustentam e como cultura/clima/solo/estágio influenciam.",
      "favorableFactors": ["Sinais ou condições que favorecem a hipótese."],
      "uncertaintyFactors": ["O que reduz confiança ou falta confirmar."],
      "potentialImpact": "Impacto potencial na produção se a hipótese se confirmar ou avançar."
    }
  ],
  "visualFindings": ["O que foi identificado visualmente ou relatado; se imagem for limitada, explique sem encerrar a análise."],
  "possibleCauses": ["Causas prováveis bióticas, abióticas, ambientais ou de manejo."],
  "missingQuestions": [],
  "riskLevel": "low | medium | high",
  "confidenceLevel": "low | medium | high",
  "productionImpact": "Impacto potencial na produtividade, qualidade, área foliar, estande ou comercialização.",
  "attentionPoints": ["Pontos que chamaram atenção e devem ser monitorados."],
  "initialRecommendation": "Recomendação inicial segura e acionável, sem doses ou prescrição controlada.",
  "safeInitialRecommendations": ["Ações iniciais seguras e práticas para o produtor."],
  "whenToCallHumanSpecialist": "Quando a revisão humana é recomendada como continuidade especializada.",
  "humanReviewReason": "Explicação clara do motivo da revisão humana, sem parecer falha da IA.",
  "conversationalAnswer": ${hasQuestion ? '"resposta conversacional direta para a pergunta complementar"' : "null"},
  "knowledgeUsed": [],
  "internetResearch": {
    "status": "success | unavailable | error",
    "query": "consulta feita na internet",
    "summary": "síntese do que foi aproveitado da pesquisa externa ou limitação encontrada",
    "sources": [{ "title": "título da fonte externa", "url": "URL quando disponível" }]
  },
  "sourceMetadata": {
    "searchAttempted": true,
    "searchSucceeded": true,
    "internalKnowledgeAttempted": true,
    "internalKnowledgeUsed": false,
    "internalKnowledgeAvailable": false,
    "modelFallbackUsed": false,
    "cacheUsed": false,
    "sources": [],
    "sourceLabel": "Fonte usada: pesquisa na internet"
  },
  "disclaimer": "${AGRONOMIC_AI_DISCLAIMER}"
}`;
}

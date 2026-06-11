import type { InternetResearchResult, InternetResearchSource } from "../providers/types";

type SearchCase = {
  crop?: string | null;
  growth_stage?: string | null;
  symptoms?: string | null;
  history?: string | null;
  farm?: {
    city?: string | null;
    state?: string | null;
    soil_type?: string | null;
  } | null;
};

type OpenAiResponseContent = {
  text?: string;
  annotations?: unknown[];
};

type OpenAiResponseOutput = {
  type?: string;
  status?: string;
  action?: {
    type?: string;
    query?: string;
    sources?: unknown[];
  };
  content?: OpenAiResponseContent[];
};

const MAX_QUERY_CHARS = 260;
const MAX_SUMMARY_CHARS = 6000;
const MAX_SOURCES = 8;
const DEFAULT_WEB_SEARCH_MODEL = "gpt-4.1";

function cleanText(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const clean = cleanText(value);
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

function modelSupportsTemperature(model: string) {
  return !model.toLowerCase().startsWith("gpt-5");
}

function buildSearchQuery(caseData: SearchCase, question?: string) {
  const crop = cleanText(caseData.crop);
  const symptoms = cleanText(caseData.symptoms);
  const growthStage = cleanText(caseData.growth_stage);
  const soilType = cleanText(caseData.farm?.soil_type);
  const location = [caseData.farm?.city, caseData.farm?.state]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const asked = cleanText(question);

  return truncate(
    [
      crop ? `cultura ${crop}` : "cultura agrícola",
      symptoms ? `sintomas ${symptoms}` : null,
      growthStage ? `estádio ${growthStage}` : null,
      soilType ? `solo ${soilType}` : null,
      location ? `região ${location}` : null,
      asked ? `pergunta ${asked}` : null,
      "manejo agronômico doença praga deficiência fontes técnicas recentes Brasil",
    ]
      .filter(Boolean)
      .join(" "),
    MAX_QUERY_CHARS,
  );
}

function normalizeTextFromOpenAiPayload(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const text = output
    .flatMap((item: OpenAiResponseOutput) => (Array.isArray(item.content) ? item.content : []))
    .map((part: OpenAiResponseContent) => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  return "";
}

function getAnnotationSources(payload: any) {
  const sources: InternetResearchSource[] = [];
  const seen = new Set<string>();
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const annotations = Array.isArray(part?.annotations) ? part.annotations : [];
      for (const annotation of annotations) {
        const url = cleanText(annotation?.url || annotation?.source?.url);
        const title = cleanText(annotation?.title || annotation?.source?.title || url);
        if (!url && !title) {
          continue;
        }

        const key = `${title}::${url}`.toLowerCase();
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        sources.push({ title: title || url, url: url || undefined });
        if (sources.length >= MAX_SOURCES) {
          return sources;
        }
      }
    }
  }

  return sources;
}

function normalizeSourceCandidate(source: any): InternetResearchSource | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const url = cleanText(
    source.url ||
      source.uri ||
      source.link ||
      source.source?.url ||
      source.url_citation?.url,
  );
  const title = cleanText(
    source.title ||
      source.name ||
      source.source?.title ||
      source.url_citation?.title ||
      url,
  );

  if (!url && !title) {
    return null;
  }

  return { title: title || url, url: url || undefined };
}

function getActionSources(payload: any) {
  const sources: InternetResearchSource[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    const actionSources = Array.isArray(item?.action?.sources)
      ? item.action.sources
      : [];

    for (const source of actionSources) {
      const normalized = normalizeSourceCandidate(source);
      if (normalized) {
        sources.push(normalized);
      }
    }
  }

  return sources;
}

function dedupeSources(sources: InternetResearchSource[]) {
  const seen = new Set<string>();
  const normalized: InternetResearchSource[] = [];

  for (const source of sources) {
    const key = `${source.title}::${source.url ?? ""}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(source);
    if (normalized.length >= MAX_SOURCES) {
      break;
    }
  }

  return normalized;
}

function getWebSearchCallState(payload: any) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const calls = output.filter((item: OpenAiResponseOutput) => item?.type === "web_search_call");

  return {
    attempted: calls.length > 0,
    completed: calls.some((item: OpenAiResponseOutput) => item.status === "completed"),
  };
}


function unavailableResult(query: string, message: string): InternetResearchResult {
  return {
    status: "unavailable",
    query,
    summary: message,
    sources: [],
  };
}

export async function searchInternetForAgronomicCase(
  caseData: SearchCase,
  question?: string,
): Promise<InternetResearchResult> {
  const query = buildSearchQuery(caseData, question);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return unavailableResult(
      query,
      "Pesquisa externa indisponível nesta execução porque o servidor não possui um provedor de busca configurado.",
    );
  }

  const model = process.env.OPENAI_WEB_SEARCH_MODEL || DEFAULT_WEB_SEARCH_MODEL;
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Você é um assistente de pesquisa agronômica. Use busca na web para localizar informações técnicas atuais e confiáveis. Responda em português do Brasil, com síntese objetiva e cautelosa, sem prescrever doses de defensivos.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Pesquise na internet informações técnicas recentes e fontes confiáveis para apoiar esta consulta agronômica. Consulta: ${query}. Retorne uma síntese prática, principais alertas e referências encontradas.`,
          },
        ],
      },
    ],
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 1800,
  };

  if (modelSupportsTemperature(model)) {
    body.temperature = 0.2;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const providerMessage = cleanText(payload?.error?.message);
      console.warn("Pesquisa externa agronômica indisponível.", providerMessage || response.statusText);
      return {
        status: "error",
        query,
        summary:
          "A pesquisa externa foi solicitada, mas o provedor de busca retornou instabilidade. Nenhum conteúdo externo foi validado nesta etapa.",
        sources: [],
      };
    }

    const searchCall = getWebSearchCallState(payload);
    const summary = truncate(normalizeTextFromOpenAiPayload(payload), MAX_SUMMARY_CHARS);
    const sources = dedupeSources([
      ...getAnnotationSources(payload),
      ...getActionSources(payload),
    ]);

    if (!searchCall.attempted || !searchCall.completed) {
      console.warn(
        "Pesquisa externa agronômica não confirmou execução do web_search.",
        { attempted: searchCall.attempted, completed: searchCall.completed },
      );
      return {
        status: "error",
        query,
        summary:
          "A pesquisa externa foi solicitada, mas o provedor não confirmou a execução da busca. Nenhum conteúdo externo foi validado nesta etapa.",
        sources: [],
      };
    }

    return {
      status: summary ? "success" : "error",
      query,
      summary:
        summary ||
        "A pesquisa externa foi executada, mas não retornou conteúdo aproveitável para esta consulta.",
      sources,
    };
  } catch (error) {
    console.warn("Falha ao executar pesquisa externa agronômica.", error);
    return {
      status: "error",
      query,
      summary:
        "A pesquisa externa foi solicitada, mas não pôde ser concluída por instabilidade temporária. Nenhum conteúdo externo foi validado nesta etapa.",
      sources: [],
    };
  }
}

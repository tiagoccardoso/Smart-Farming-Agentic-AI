export type AIProviderName = "openai" | "gemini";
export type AIRiskLevel = "low" | "medium" | "high";
export type AIConfidenceLevel = "low" | "medium" | "high";

export type AgronomicDetailedHypothesis = {
  name: string;
  probability: AIConfidenceLevel;
  justification: string;
  favorableFactors: string[];
  uncertaintyFactors: string[];
  potentialImpact: string;
};

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * Imagens anexadas a esta mensagem (somente role "user"). Devem trazer o
   * conteúdo em base64 para que o modelo receba a imagem de fato; uma URL
   * sozinha não garante que o modelo consiga ver o arquivo.
   */
  images?: AIImageInput[];
};

export type AIImageInput = {
  url?: string;
  base64?: string;
  mimeType?: string;
  description?: string;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AIProviderCallOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  promptType?: string;
  responseSchema?: unknown;
  /** Esforço de raciocínio para modelos que o suportam (gpt-5*, o*). */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
};

export type AIProviderResult<T = string> = {
  provider: AIProviderName;
  model: string;
  content: T;
  usage: AIUsage;
  responseTimeMs: number;
  raw?: unknown;
};

export type AIHealthCheck = {
  provider: AIProviderName;
  configured: boolean;
  ok: boolean;
  model?: string;
  message?: string;
};

export interface AIProvider {
  readonly name: AIProviderName;
  generateText(messages: AIMessage[], options?: AIProviderCallOptions): Promise<AIProviderResult<string>>;
  generateStructuredOutput<T>(messages: AIMessage[], options?: AIProviderCallOptions): Promise<AIProviderResult<T>>;
  generateEmbeddings(input: string | string[], options?: AIProviderCallOptions): Promise<AIProviderResult<number[][]>>;
  analyzeImages(images: AIImageInput[], prompt: string, options?: AIProviderCallOptions): Promise<AIProviderResult<string>>;
  healthCheck(): Promise<AIHealthCheck>;
}

export type InternetResearchStatus = "success" | "unavailable" | "error";

export type InternetResearchSource = {
  title: string;
  url?: string;
  snippet?: string;
};

export type InternetResearchResult = {
  status: InternetResearchStatus;
  query: string;
  summary: string;
  sources: InternetResearchSource[];
};

export type AgronomicSourceMetadata = {
  searchAttempted: boolean;
  searchSucceeded: boolean;
  internalKnowledgeAttempted: boolean;
  internalKnowledgeUsed: boolean;
  internalKnowledgeAvailable: boolean;
  modelFallbackUsed: boolean;
  cacheUsed: boolean;
  sources: InternetResearchSource[];
  sourceLabel: string;
  errorMessage?: string;
};

export type AgronomicAnalysisOutput = {
  popularSummary: string;
  technicalDetails: string;
  initialDiagnosis: string;
  probableHypotheses: string[];
  detailedHypotheses: AgronomicDetailedHypothesis[];
  visualFindings: string[];
  possibleCauses: string[];
  missingQuestions: string[];
  riskLevel: AIRiskLevel;
  confidenceLevel: AIConfidenceLevel;
  productionImpact: string;
  attentionPoints: string[];
  initialRecommendation: string;
  safeInitialRecommendations: string[];
  whenToCallHumanSpecialist: string;
  humanReviewReason: string;
  knowledgeUsed: Array<{ title: string; category: string }>;
  internetResearch: InternetResearchResult;
  sourceMetadata: AgronomicSourceMetadata;
  disclaimer: string;
  conversationalAnswer?: string;
  /** Cuidados e medidas preventivas (opcional; ausente em análises antigas). */
  preventiveCare?: string[];
  /** Próximos passos objetivos (opcional; ausente em análises antigas). */
  nextSteps?: string[];
};

export type KnowledgeDocument = {
  id?: string;
  title: string;
  category: string;
  crop?: string | null;
  content: string;
  similarity?: number | null;
};

export type AIUsageLogInput = {
  userId?: string | null;
  provider: AIProviderName | "local";
  model: string;
  promptType: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  responseTimeMs: number;
  success: boolean;
  fallbackUsed: boolean;
};

/**
 * Presencial & Projetos Especiais: tipos de serviço da solicitação de orçamento.
 *
 * Fica fora das rotas porque um arquivo `route.ts` do Next.js só pode exportar
 * handlers e as opções de rota.
 */

export const QUOTE_REQUEST_TYPE = "presencial_projetos";
export const QUOTE_SOURCE = "orcamento";

export const QUOTE_SERVICE_TYPES = [
  "visita_tecnica",
  "diagnostico_de_campo",
  "avaliacao_da_propriedade",
  "projeto_personalizado",
  "planejamento_e_acompanhamento",
  "transicao_organica",
  "outro"
] as const;

export type QuoteServiceType = (typeof QUOTE_SERVICE_TYPES)[number];

export const QUOTE_SERVICE_LABELS: Record<QuoteServiceType, string> = {
  visita_tecnica: "Visita técnica",
  diagnostico_de_campo: "Diagnóstico de campo",
  avaliacao_da_propriedade: "Avaliação da propriedade",
  projeto_personalizado: "Projeto personalizado",
  planejamento_e_acompanhamento: "Planejamento e acompanhamento",
  transicao_organica: "Conversão/transição para produção orgânica",
  outro: "Outro projeto agronômico presencial"
};

export function isQuoteServiceType(value: unknown): value is QuoteServiceType {
  return typeof value === "string" && (QUOTE_SERVICE_TYPES as readonly string[]).includes(value);
}

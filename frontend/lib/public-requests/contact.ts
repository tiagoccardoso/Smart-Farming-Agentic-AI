/**
 * Formulario de Contato: tipos de solicitacao.
 *
 * Usa exatamente as mesmas opcoes do campo "Tipo de serviço" da Solicitacao de
 * Orcamento (lib/service-quotes.ts), para os dois formularios falarem a mesma
 * lingua. Fica fora de `app/api/contact/route.ts` porque um arquivo de rota do
 * Next.js so pode exportar handlers e opcoes de rota.
 */

import { QUOTE_SERVICE_LABELS, QUOTE_SERVICE_TYPES, isQuoteServiceType, type QuoteServiceType } from "../service-quotes";

/** Tipos que exigem telefone, cidade, estado, dia e horario (agendamento de visita). */
export const CONTACT_VISIT_REQUEST_TYPES: readonly QuoteServiceType[] = ["visita_tecnica"];

export const CONTACT_REQUEST_TYPE_OPTIONS = QUOTE_SERVICE_TYPES.map((value) => ({ value, label: QUOTE_SERVICE_LABELS[value] }));

export const CONTACT_REQUEST_TYPE_LABELS: Record<string, string> = { ...QUOTE_SERVICE_LABELS };

/**
 * Tipos antigos do formulario de Contato. Continuam apenas para exibir
 * registros ja gravados e para aceitar links antigos (?requestType=...).
 */
export const LEGACY_CONTACT_REQUEST_TYPE_LABELS: Record<string, string> = {
  consultoria_geral: "Consultoria geral",
  revisao_caso_agricola: "Revisão de caso agrícola",
  visita_agricultura_organica: "Visita para agricultura orgânica",
  conversao_propriedade_organica: "Conversão de propriedade para orgânica"
};

const LEGACY_TO_CURRENT: Record<string, QuoteServiceType> = {
  visita_agricultura_organica: "visita_tecnica",
  conversao_propriedade_organica: "transicao_organica"
};

/** Converte um valor (atual ou de link antigo) para uma opcao valida, ou null. */
export function normalizeContactRequestType(value: unknown): QuoteServiceType | null {
  if (isQuoteServiceType(value)) return value;
  if (typeof value === "string" && value in LEGACY_TO_CURRENT) return LEGACY_TO_CURRENT[value];
  return null;
}

export function isContactRequestType(value: unknown): value is QuoteServiceType {
  return isQuoteServiceType(value);
}

export function isContactVisitType(value: unknown) {
  return typeof value === "string" && (CONTACT_VISIT_REQUEST_TYPES as readonly string[]).includes(value);
}

/** Rotulo para exibicao (inclui os tipos antigos ja gravados). */
export function contactRequestTypeLabel(value: string | null | undefined) {
  if (!value) return "-";
  return CONTACT_REQUEST_TYPE_LABELS[value] ?? LEGACY_CONTACT_REQUEST_TYPE_LABELS[value] ?? value;
}

/**
 * Formulario de Contato: tipos de solicitacao.
 *
 * Fica fora de `app/api/contact/route.ts` porque um arquivo de rota do Next.js
 * so pode exportar handlers e opcoes de rota.
 */

export const CONTACT_VISIT_REQUEST_TYPES = ["visita_agricultura_organica", "conversao_propriedade_organica"] as const;

export const CONTACT_REQUEST_TYPE_OPTIONS = [
  { value: "consultoria_geral", label: "Consultoria geral" },
  { value: "revisao_caso_agricola", label: "Revisão de caso agrícola" },
  { value: "visita_agricultura_organica", label: "Visita para agricultura orgânica" },
  { value: "conversao_propriedade_organica", label: "Conversão de propriedade para orgânica" }
] as const;

export const CONTACT_REQUEST_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CONTACT_REQUEST_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

export function isContactRequestType(value: unknown): value is string {
  return typeof value === "string" && value in CONTACT_REQUEST_TYPE_LABELS;
}

export function isContactVisitType(value: unknown) {
  return typeof value === "string" && (CONTACT_VISIT_REQUEST_TYPES as readonly string[]).includes(value);
}

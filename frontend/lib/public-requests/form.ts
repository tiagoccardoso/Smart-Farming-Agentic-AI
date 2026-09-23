/**
 * Formulario unico de Contato e Solicitacao de Orcamento.
 *
 * Campos, regras e mensagens usados TANTO no navegador (feedback imediato)
 * QUANTO no servidor (validacao definitiva). Assim os dois fluxos nao voltam a
 * divergir: a unica diferenca entre eles e a ORIGEM, gravada na coluna
 * `source` de specialist_visit_requests (ver PUBLIC_REQUEST_SOURCES).
 *
 * Sem dependencias de servidor ou de React.
 */

import { PUBLIC_REQUEST_SOURCES } from "./config";
import { isContactVisitType, normalizeContactRequestType } from "./contact";
import type { QuoteServiceType } from "../service-quotes";

/** Contexto em que o formulario foi aberto: /contact ou /solicitar-orcamento. */
export type PublicRequestOrigin = keyof typeof PUBLIC_REQUEST_SOURCES;

export function isPublicRequestOrigin(value: unknown): value is PublicRequestOrigin {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PUBLIC_REQUEST_SOURCES, value);
}

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
] as const;

export const PUBLIC_REQUEST_LIMITS = {
  name: 200,
  email: 200,
  phone: 40,
  city: 120,
  preferredTime: 40,
  message: 4000,
  minMessage: 10
} as const;

export const PUBLIC_REQUEST_SUCCESS_MESSAGE =
  "Recebemos sua solicitação. A especialista entrará em contato pelo telefone informado para entender sua necessidade. Nenhuma cobrança é feita sem a sua aprovação.";

export const PUBLIC_REQUEST_ERROR_MESSAGE = "Não foi possível enviar sua solicitação agora. Tente novamente em instantes.";

/** Valores digitados (sempre texto). A ordem segue a ordem visual do formulario. */
export type PublicRequestFormInput = {
  name: string;
  phone: string;
  email: string;
  requestType: string;
  city: string;
  state: string;
  propertyId: string;
  preferredDate: string;
  preferredTime: string;
  message: string;
};

export type PublicRequestFormField = keyof PublicRequestFormInput;

export const PUBLIC_REQUEST_FORM_FIELDS: readonly PublicRequestFormField[] = [
  "name",
  "phone",
  "email",
  "requestType",
  "city",
  "state",
  "propertyId",
  "preferredDate",
  "preferredTime",
  "message"
];

export function isPublicRequestFormField(value: unknown): value is PublicRequestFormField {
  return typeof value === "string" && (PUBLIC_REQUEST_FORM_FIELDS as readonly string[]).includes(value);
}

export const EMPTY_PUBLIC_REQUEST_FORM: PublicRequestFormInput = {
  name: "",
  phone: "",
  email: "",
  requestType: "",
  city: "",
  state: "",
  propertyId: "",
  preferredDate: "",
  preferredTime: "",
  message: ""
};

export type ValidatedPublicRequest = {
  name: string;
  phone: string;
  email: string | null;
  requestType: QuoteServiceType;
  city: string;
  state: string;
  propertyId: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  message: string | null;
};

export type PublicRequestValidation =
  | { ok: true; value: ValidatedPublicRequest }
  | { ok: false; field: PublicRequestFormField; message: string };

type ValidateOptions = {
  /** Com audio anexado, a descricao escrita passa a ser opcional. */
  hasAudio: boolean;
  /** Data minima aceita (YYYY-MM-DD). Vazio = nao verifica. */
  minDate?: string;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Data local do navegador no formato YYYY-MM-DD. */
export function localIsoDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Data UTC deslocada em dias (o servidor aceita "ontem" por causa do fuso). */
export function utcIsoDateOffset(days: number, now = new Date()) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fail(field: PublicRequestFormField, message: string): PublicRequestValidation {
  return { ok: false, field, message };
}

/**
 * Valida e normaliza os campos. Retorna o PRIMEIRO problema na ordem visual,
 * para o formulario levar o foco direto ao campo correspondente.
 */
export function validatePublicRequestForm(input: Partial<Record<PublicRequestFormField, unknown>>, options: ValidateOptions): PublicRequestValidation {
  const name = clean(input.name, PUBLIC_REQUEST_LIMITS.name);
  const phone = clean(input.phone, PUBLIC_REQUEST_LIMITS.phone);
  const email = clean(input.email, PUBLIC_REQUEST_LIMITS.email);
  const requestType = normalizeContactRequestType(clean(input.requestType, 60));
  const city = clean(input.city, PUBLIC_REQUEST_LIMITS.city);
  const state = clean(input.state, 2).toUpperCase();
  const propertyId = clean(input.propertyId, 80);
  const preferredDate = clean(input.preferredDate, 10);
  const preferredTime = clean(input.preferredTime, PUBLIC_REQUEST_LIMITS.preferredTime);
  const message = clean(input.message, PUBLIC_REQUEST_LIMITS.message);
  const digits = phoneDigits(phone);
  const isVisit = isContactVisitType(requestType);

  if (name.length < 2) return fail("name", "Informe seu nome.");
  if (!phone) return fail("phone", "Informe um telefone ou WhatsApp para retorno.");
  if (digits.length < 10 || digits.length > 13) return fail("phone", "Informe o telefone com DDD, por exemplo (11) 91234-5678.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email", "Informe um e-mail válido ou deixe o campo em branco.");
  if (!requestType) return fail("requestType", "Selecione o tipo de atendimento.");
  if (city.length < 2) return fail("city", "Informe a cidade.");
  if (!(BRAZILIAN_STATES as readonly string[]).includes(state)) return fail("state", "Selecione o estado (UF).");
  if (propertyId && !/^[A-Za-z0-9-]{1,80}$/.test(propertyId)) return fail("propertyId", "Selecione uma propriedade válida.");

  if (isVisit && !preferredDate) return fail("preferredDate", "Para visita técnica, informe a data desejada.");
  if (preferredDate && !isValidIsoDate(preferredDate)) return fail("preferredDate", "Informe uma data válida.");
  if (preferredDate && options.minDate && preferredDate < options.minDate) return fail("preferredDate", "Escolha uma data a partir de hoje.");
  if (isVisit && !preferredTime) return fail("preferredTime", "Para visita técnica, informe o horário ou período desejado.");

  if (!options.hasAudio && message.length < PUBLIC_REQUEST_LIMITS.minMessage) {
    return fail("message", `Descreva sua necessidade com pelo menos ${PUBLIC_REQUEST_LIMITS.minMessage} caracteres ou grave um áudio explicando.`);
  }

  return {
    ok: true,
    value: {
      name,
      phone,
      email: email || null,
      requestType,
      city,
      state,
      propertyId: propertyId || null,
      preferredDate: preferredDate || null,
      preferredTime: preferredTime || null,
      message: message || null
    }
  };
}

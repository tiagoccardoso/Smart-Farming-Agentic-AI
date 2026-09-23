"use client";

/**
 * Presencial & Projetos Especiais — solicitação de orçamento.
 *
 * Mesmo formulário do Contato (components/public-request/PublicRequestForm).
 * A origem "quote" é registrada pelo servidor como source = 'orcamento' e
 * exibida para a especialista com o selo "Solicitação de orçamento".
 * Categoria sob consulta: nenhuma cobrança automática antes da definição do
 * orçamento.
 */

import PublicRequestForm from "../../components/public-request/PublicRequestForm";

export default function SolicitarOrcamentoPage() {
  return <PublicRequestForm origin="quote" />;
}

"use client";

/**
 * Contato oficial (/contact).
 *
 * Mesmo formulario da Solicitacao de Orcamento (components/public-request/
 * PublicRequestForm). A origem "contact" e registrada pelo servidor como
 * source = 'agendamento'.
 */

import PublicRequestForm from "../../components/public-request/PublicRequestForm";

export default function ContactPage() {
  return <PublicRequestForm origin="contact" />;
}

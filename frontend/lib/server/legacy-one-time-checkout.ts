/**
 * Encerramento das contratações avulsas (modelo comercial antigo).
 *
 * Revisão humana avulsa (R$ 197), interpretação de análise de solo (R$ 250),
 * relatório técnico, acompanhamento mensal e parecer técnico avulso não são
 * mais vendidos. As rotas continuam existindo apenas para responder de forma
 * explícita a clientes antigos (abas abertas, apps em cache) — nenhuma sessão
 * de checkout é criada.
 *
 * O histórico é preservado: pedidos (`one_time_orders`), pagamentos já feitos,
 * créditos e o processamento do webhook de sessões antigas não são alterados.
 */

import { NextResponse } from "next/server";

export function legacyOneTimeCheckoutGone() {
  return NextResponse.json(
    {
      error:
        "A contratação avulsa foi encerrada. O parecer agronômico humano agora está incluído nos planos PlantaSa IA Profissional e PlantaSa Consultoria Agronômica. Para visitas técnicas e projetos especiais, fale com a equipe pela página de Contato.",
      code: "ONE_TIME_CHECKOUT_DISCONTINUED",
      options: [
        { label: "Ver planos", href: "/planos" },
        { label: "Falar com a equipe", href: "/contact" }
      ]
    },
    { status: 410 }
  );
}

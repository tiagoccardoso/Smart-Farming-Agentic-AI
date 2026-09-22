"use client";

/**
 * Retorno do Stripe apos o pagamento.
 *
 * Esta pagina NAO libera nada: a confirmacao e feita pelo webhook. Aqui apenas
 * explicamos o que acontece e oferecemos o caminho seguinte.
 */

import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 shadow-soft sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Pagamento recebido</p>
        <h1 className="mt-3 text-2xl font-black text-emerald-900 sm:text-3xl">Obrigado! Estamos confirmando seu pagamento.</h1>
        <p className="mt-4 text-sm leading-6 text-emerald-900">
          A confirmacao definitiva vem do Stripe e costuma levar alguns segundos. Assim que ela chegar, seu plano ou seu
          parecer tecnico e liberado automaticamente — voce nao precisa pagar de novo nem repetir o processo.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/minha-assinatura"
            className="rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800"
          >
            Ver minha assinatura
          </Link>
          <Link
            href="/pareceres"
            className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-center text-sm font-bold text-leaf-700 shadow-sm transition hover:bg-leaf-50"
          >
            Meus pareceres tecnicos
          </Link>
        </div>
      </div>
    </main>
  );
}

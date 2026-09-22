"use client";

import Link from "next/link";

export default function CheckoutCanceledPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 shadow-soft sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Pagamento não concluído</p>
        <h1 className="mt-3 text-2xl font-black text-amber-900 sm:text-3xl">Você cancelou o pagamento.</h1>
        <p className="mt-4 text-sm leading-6 text-amber-900">
          Nada foi cobrado e seu plano atual continua como estava. Você pode retomar a contratacao quando quiser.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/planos"
            className="rounded-full bg-leaf-700 px-6 py-3 text-center text-sm font-bold text-white shadow-soft transition hover:bg-leaf-800"
          >
            Voltar para os planos
          </Link>
          <Link
            href="/contact"
            className="rounded-full border border-amber-300 bg-white px-6 py-3 text-center text-sm font-bold text-amber-800 shadow-sm transition hover:bg-amber-50"
          >
            Falar com a equipe
          </Link>
        </div>
      </div>
    </main>
  );
}

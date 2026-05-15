import Link from "next/link";
import SectionTitle from "../../components/SectionTitle";

const reviewSteps = [
  "Escolher um caso enviado",
  "Conferir dados, fotos e análise de solo",
  "Solicitar revisão por Doutora em Agronomia",
  "Receber parecer técnico quando estiver pronto"
];

export default function RevisaoHumanaPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-8">
          <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
            Validação especializada
          </p>
          <SectionTitle
            title="Revisão Humana"
            subtitle="Solicite que uma Doutora em Agronomia revise seu caso."
          />
          <p className="text-base leading-7 text-slate-700">
            Use esta etapa quando o caso exigir mais segurança técnica, como suspeita de doença, perdas de produtividade ou decisão de manejo importante.
          </p>
          <Link href="/enviar-caso" className="mt-6 inline-flex rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
            Preparar caso
          </Link>
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft md:p-8">
          <h3 className="text-xl font-semibold text-slate-900">Como será o acompanhamento</h3>
          <div className="mt-6 space-y-4">
            {reviewSteps.map((step, index) => (
              <div key={step} className="flex items-center gap-4 rounded-2xl bg-leaf-50 p-4 text-sm text-slate-700">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf-600 font-semibold text-white">
                  {index + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="font-semibold text-slate-900">Mais confiança</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">A revisão humana ajuda a validar a orientação inicial antes de decisões sensíveis.</p>
        </div>
        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="font-semibold text-slate-900">Comunicação clara</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">O produtor acompanha o status e entende quais dados ainda podem faltar.</p>
        </div>
        <div className="rounded-3xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
          <h3 className="font-semibold text-slate-900">Parecer técnico</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">A entrega final poderá virar relatório para consulta e histórico da propriedade.</p>
        </div>
      </div>
    </section>
  );
}

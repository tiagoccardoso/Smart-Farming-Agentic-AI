import SectionTitle from "../../components/SectionTitle";

const plans = [
  {
    name: "IA no Campo",
    price: "Entrada",
    description: "Para produtores que querem fazer perguntas rápidas e organizar orientações iniciais.",
    features: ["Consultoria com IA", "Histórico básico", "Linguagem simples"]
  },
  {
    name: "Relatórios da Safra",
    price: "Intermediário",
    description: "Para quem precisa registrar casos, acompanhar diagnósticos e guardar relatórios por cultura.",
    features: ["Envio de casos", "Relatórios organizados", "Pré-análise por IA"]
  },
  {
    name: "Revisão Especialista",
    price: "Completo",
    description: "Para decisões que precisam de revisão humana e parecer técnico de uma Doutora em Agronomia.",
    features: ["Revisão humana", "Parecer técnico", "Prioridade de acompanhamento"]
  }
];

export default function PlanosPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Planos de atendimento
        </p>
        <SectionTitle
          title="Planos"
          subtitle="Escolha entre planos com IA, relatórios e revisão humana."
        />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          A ideia é permitir que cada produtor escolha o nível de apoio que combina com o tamanho da operação e a urgência dos casos.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.name} className="flex flex-col rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <p className="text-sm font-semibold uppercase tracking-wide text-leaf-700">{plan.price}</p>
            <h3 className="mt-3 text-2xl font-bold text-slate-900">{plan.name}</h3>
            <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{plan.description}</p>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-leaf-100 text-xs text-leaf-700">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <button className="mt-8 rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
              Conhecer plano
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

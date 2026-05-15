import SectionTitle from "../../components/SectionTitle";

const plans = [
  {
    name: "Essencial",
    price: "R$ 49/mês",
    description: "Consultoria IA e histórico básico para pequenos produtores."
  },
  {
    name: "Profissional",
    price: "R$ 149/mês",
    description: "Inclui envio de casos e revisão humana conforme franquia do plano."
  },
  {
    name: "Premium",
    price: "Sob consulta",
    description: "Prioridade na fila, múltiplas propriedades e acompanhamento especializado."
  }
];

export default function PlanosPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle
        title="Planos"
        subtitle="Escolha o nível de suporte ideal para combinar orientação por IA e revisão humana especializada."
      />

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.name} className="flex flex-col rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-xl font-semibold text-slate-900">{plan.name}</h3>
            <p className="mt-3 text-2xl font-bold text-leaf-700">{plan.price}</p>
            <p className="mt-4 flex-1 text-sm text-slate-600">{plan.description}</p>
            <button className="mt-6 rounded-full bg-leaf-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
              Conhecer plano
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

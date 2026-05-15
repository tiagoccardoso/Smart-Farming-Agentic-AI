import SectionTitle from "../../components/SectionTitle";

const metrics = [
  { label: "Casos enviados", value: "0", color: "text-leaf-700" },
  { label: "Respostas da IA para revisar", value: "0", color: "text-sun-600" },
  { label: "Relatórios emitidos", value: "0", color: "text-slate-900" }
];

const workAreas = [
  {
    title: "Fila de casos",
    description: "Visualize produtores aguardando análise, cultura envolvida, urgência e dados recebidos."
  },
  {
    title: "Revisão da IA",
    description: "Confira a pré-análise, ajuste termos técnicos e indique se faltam informações para concluir."
  },
  {
    title: "Relatório técnico",
    description: "Prepare recomendações claras, com linguagem objetiva e adequada à realidade do produtor rural."
  }
];

export default function PainelDoutoraPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Área técnica da especialista
        </p>
        <SectionTitle
          title="Painel da Doutora"
          subtitle="Gerencie casos enviados, revise respostas da IA e emita relatórios técnicos."
        />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Uma base inicial para a rotina da agrônoma responsável por validar atendimentos, priorizar casos e publicar pareceres.
        </p>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <p className="text-sm font-medium text-slate-500">{metric.label}</p>
            <p className={`mt-3 text-4xl font-bold ${metric.color}`}>{metric.value}</p>
            <p className="mt-3 text-sm text-slate-500">Indicador visual de exemplo para a estrutura inicial.</p>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {workAreas.map((area) => (
          <article key={area.title} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <h3 className="text-lg font-semibold text-slate-900">{area.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{area.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

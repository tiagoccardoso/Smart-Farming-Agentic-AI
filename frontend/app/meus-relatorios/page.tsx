import SectionTitle from "../../components/SectionTitle";

const reports = [
  {
    title: "Relatórios de IA",
    status: "Orientações iniciais",
    description: "Resumo das perguntas feitas, hipóteses levantadas e recomendações de próximos passos.",
    icon: "🤖"
  },
  {
    title: "Diagnósticos de casos",
    status: "Pré-análises",
    description: "Histórico dos casos enviados com dados da cultura, sintomas, fotos e anexos importantes.",
    icon: "📋"
  },
  {
    title: "Revisões humanas",
    status: "Pareceres técnicos",
    description: "Documentos revisados por especialista para apoiar decisões no manejo da propriedade.",
    icon: "👩‍🌾"
  }
];

export default function MeusRelatoriosPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          Histórico do produtor
        </p>
        <SectionTitle
          title="Meus Relatórios"
          subtitle="Acesse seus relatórios, diagnósticos e históricos de atendimento."
        />
        <p className="max-w-3xl text-base leading-7 text-slate-700">
          Tudo ficará reunido em um só lugar para facilitar a consulta por safra, cultura, talhão ou tipo de atendimento.
        </p>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {reports.map((report) => (
          <article key={report.title} className="flex min-h-64 flex-col rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-leaf-50 text-2xl" aria-hidden>
                {report.icon}
              </span>
              <span className="rounded-full bg-sun-50 px-3 py-1 text-xs font-semibold text-sun-700">{report.status}</span>
            </div>
            <h3 className="mt-6 text-lg font-semibold text-slate-900">{report.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{report.description}</p>
            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              Nenhum item listado ainda. Este espaço receberá seus registros futuramente.
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

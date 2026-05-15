import SectionTitle from "../../components/SectionTitle";

const caseSections = [
  {
    title: "Dados da cultura",
    description: "Informe cultura, variedade, área, estágio da planta, talhão e localização aproximada.",
    icon: "🌾"
  },
  {
    title: "Sintomas no campo",
    description: "Descreva manchas, amarelecimento, pragas, falhas de desenvolvimento e quando o problema começou.",
    icon: "🔎"
  },
  {
    title: "Fotos e documentos",
    description: "Separe imagens das plantas, da lavoura, raízes, folhas e arquivos como análise de solo.",
    icon: "📷"
  },
  {
    title: "Histórico de manejo",
    description: "Registre irrigação, adubação, defensivos aplicados, chuva recente e qualquer mudança importante.",
    icon: "📝"
  }
];

export default function EnviarCasoPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
      <div className="rounded-3xl bg-hero-gradient p-6 shadow-soft md:p-10">
        <div className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
            Preparação do atendimento
          </p>
          <SectionTitle
            title="Enviar Caso"
            subtitle="Envie dados da cultura, sintomas, fotos e análise de solo para receber uma pré-análise."
          />
          <p className="text-base leading-7 text-slate-700">
            Esta página organiza as informações essenciais para que a IA e, depois, uma especialista possam entender melhor a realidade da propriedade.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {caseSections.map((section) => (
          <article key={section.title} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-leaf-50 text-2xl" aria-hidden>
                {section.icon}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{section.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-3xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
        <h3 className="text-lg font-semibold text-slate-900">Pré-análise sem complicação</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
          Por enquanto, esta é apenas a estrutura visual do formulário. Em uma próxima etapa, os campos e uploads serão conectados ao fluxo real de atendimento.
        </p>
      </div>
    </section>
  );
}

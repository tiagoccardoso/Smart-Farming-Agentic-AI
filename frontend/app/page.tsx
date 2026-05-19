import Image from "next/image";
import Link from "next/link";

const premiumCards = [
  { icon: "🌱", title: "Conversão para orgânico", description: "Planejamento da transição, metas por etapa e orientação para reduzir riscos produtivos." },
  { icon: "🧭", title: "Diagnóstico da propriedade", description: "Organização de informações sobre solo, histórico de manejo, culturas e desafios da lavoura." },
  { icon: "🥬", title: "Manejo de hortaliças", description: "Apoio técnico para olericultura, tomateiro, mudas, tratos culturais e nutrição." },
  { icon: "🛡️", title: "Controle de pragas e doenças", description: "Triagem de sintomas, manejo integrado e alternativas compatíveis com sistemas sustentáveis." },
  { icon: "👩‍🔬", title: "Revisão técnica humana", description: "Casos complexos podem receber validação de especialista em produção vegetal e agricultura orgânica." },
  { icon: "📋", title: "Relatórios e recomendações", description: "Pareceres organizados para apoiar decisões e priorizar próximos passos no campo." },
];

const steps = [
  { title: "Envie dados e fotos", description: "Registre cultura, sintomas, histórico de manejo, imagens da lavoura e necessidades da propriedade." },
  { title: "Receba triagem inicial por IA", description: "A tecnologia organiza hipóteses, riscos e perguntas importantes para acelerar o atendimento." },
  { title: "Conte com revisão especializada", description: "Quando necessário, a análise é complementada por orientação humana técnica e contextualizada." },
];

export default function HomePage() {
  return (
    <div className="bg-[#F6F1E8] text-[#1F2933]">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#DCEED3_0%,#F6F1E8_44%,#FDFBF7_100%)]">
        <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-[#A7C957]/25 blur-3xl" />
        <div className="absolute bottom-8 right-8 h-80 w-80 rounded-full bg-[#D7A84A]/15 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#A7C957]/50 bg-white/85 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#123F2A] shadow-soft">
              🌿 Agricultura orgânica • IA • revisão humana
            </p>
            <h1 className="max-w-4xl text-4xl font-bold leading-tight text-[#123F2A] md:text-6xl">
              Consultoria agrícola inteligente para produção orgânica e decisões no campo
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#1F2933]/80">
              Una inteligência artificial, conhecimento agronômico e revisão humana especializada para diagnosticar problemas, planejar manejos e apoiar a conversão da sua propriedade para agricultura orgânica.
            </p>
            <p className="mt-5 max-w-3xl leading-7 text-[#1F2933]/72">
              A Plantasã ajuda produtores a organizarem informações da lavoura, enviarem fotos, receberem uma triagem inicial por IA e, quando necessário, contarem com revisão técnica humana conduzida por especialista em produção vegetal, olericultura e agricultura orgânica.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/agricultura-organica" className="rounded-full bg-[#123F2A] px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#0F3322]">
                Conhecer consultoria orgânica
              </Link>
              <Link href="/consultoria-ia" className="rounded-full bg-[#A7C957] px-7 py-3 text-sm font-bold text-[#123F2A] shadow-soft transition hover:-translate-y-0.5 hover:bg-[#94B94B]">
                Iniciar consultoria com IA
              </Link>
              <Link href="/contact?requestType=conversao_propriedade_organica" className="rounded-full border border-[#123F2A]/20 bg-white px-7 py-3 text-sm font-bold text-[#123F2A] shadow-soft transition hover:-translate-y-0.5 hover:border-[#123F2A]/50">
                Falar com especialista
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-[2rem] border border-white/80 bg-white/70 p-3 shadow-soft backdrop-blur">
              <Image
                src="/images/organic-consulting-premium.svg"
                alt="Especialista em agricultura orgânica avaliando hortaliças em uma propriedade rural com apoio de tecnologia."
                width={900}
                height={620}
                className="w-full rounded-[1.5rem]"
                priority
              />
              <div className="absolute left-5 top-5 rounded-2xl border border-[#A7C957]/60 bg-white/95 p-4 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2E7D32]">Diagnóstico técnico</p>
                <p className="mt-1 text-sm font-bold text-[#123F2A]">Propriedade em conversão orgânica</p>
              </div>
              <div className="absolute bottom-5 right-5 max-w-[240px] rounded-2xl border border-[#D7A84A]/35 bg-white/95 p-4 shadow-soft">
                <p className="text-sm font-bold text-[#123F2A]">IA + especialista</p>
                <p className="mt-1 text-xs font-semibold text-[#A97142]">Orientação segura para decisões no campo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {premiumCards.map((card) => (
            <article key={card.title} className="rounded-3xl border border-[#123F2A]/10 bg-white/90 p-6 shadow-soft transition hover:-translate-y-1">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF6ED] text-2xl">{card.icon}</span>
              <h2 className="mt-5 text-xl font-bold text-[#123F2A]">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid gap-8 rounded-[2rem] border border-[#123F2A]/10 bg-white p-7 shadow-soft lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2E7D32]">Agricultura orgânica primeiro</p>
            <h2 className="mt-3 text-3xl font-bold text-[#123F2A]">Da triagem digital ao plano de manejo sustentável</h2>
            <p className="mt-4 leading-7 text-slate-700">
              O foco inicial é apoiar produtores interessados em sistemas orgânicos, hortaliças saudáveis, solo fértil e manejo integrado de pragas e doenças, sem perder a agilidade da tecnologia.
            </p>
            <Link href="/contact?requestType=visita_agricultura_organica" className="mt-6 inline-flex rounded-full bg-[#123F2A] px-6 py-3 text-sm font-bold text-white shadow-soft">
              Solicitar avaliação pelo contato
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <article key={step.title} className="rounded-3xl border border-[#123F2A]/10 bg-[#F8FCF7] p-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#A7C957] text-sm font-bold text-[#123F2A]">{index + 1}</span>
                <h3 className="mt-4 font-bold text-[#123F2A]">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-[2rem] bg-[#123F2A] p-7 text-white shadow-soft md:p-10">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#A7C957]">Próximo passo</p>
              <h2 className="mt-2 text-3xl font-bold">Organize seu caso e receba orientação com mais clareza.</h2>
              <p className="mt-3 max-w-3xl leading-7 text-white/75">
                As recomendações da IA são orientativas e não substituem avaliação agronômica presencial quando necessária. Casos críticos podem ser encaminhados para revisão humana especializada.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link href="/consultoria-ia" className="rounded-full bg-[#A7C957] px-6 py-3 text-center text-sm font-bold text-[#123F2A]">
                Iniciar consultoria com IA
              </Link>
              <Link href="/contact" className="rounded-full border border-white/30 px-6 py-3 text-center text-sm font-bold text-white">
                Falar com especialista
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

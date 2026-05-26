import Link from "next/link";
import HomeHeroImage from "../components/HomeHeroImage";
import { getSitePage } from "../lib/site-pages";

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

export default async function HomePage() {
  const page = await getSitePage("home");
  const content = page.content ?? {};
  const heroTitle =
    page.title ||
    "Consultoria agrícola inteligente para produção orgânica e decisões no campo";
  const heroSubtitle =
    page.subtitle ||
    "Una inteligência artificial, conhecimento agronômico e revisão humana especializada para diagnosticar problemas, planejar manejos e apoiar a conversão da sua propriedade para agricultura orgânica.";
  const heroText =
    content.heroText ||
    "A Plantasã ajuda produtores a organizarem informações da lavoura, enviarem fotos, receberem uma triagem inicial por IA e, quando necessário, contarem com revisão técnica humana conduzida por especialista em produção vegetal, olericultura e agricultura orgânica.";

  return (
    <div className="bg-[#fef9f0] text-[#1d1c16]">
      {/* Hero */}
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#DCEED3_0%,#fef9f0_44%,#FDFCFB_100%)]">
        <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-[#ccf078]/20 blur-3xl" />
        <div className="absolute bottom-8 right-8 h-80 w-80 rounded-full bg-[#ffe088]/25 blur-3xl" />

        <div className="relative mx-auto grid max-w-[1280px] gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#b0d360]/60 bg-white/90 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#123f2a] shadow-card">
              🌿 Agricultura orgânica • IA • revisão humana
            </p>
            <h1 className="max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[#002817] md:text-5xl lg:text-6xl">
              {heroTitle}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#1d1c16]/80">
              {heroSubtitle}
            </p>
            <p className="mt-5 max-w-3xl leading-7 text-[#414943]">
              {heroText}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={content.primaryButtonUrl || "/agricultura-organica"}
                className="rounded-full bg-[#123f2a] px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#002817] active:translate-y-0"
              >
                {content.primaryButtonText || "Conhecer consultoria orgânica"}
              </Link>
              <Link
                href={content.secondaryButtonUrl || "/consultoria-ia"}
                className="rounded-full bg-[#ccf078] px-7 py-3 text-sm font-bold text-[#123f2a] shadow-soft transition hover:-translate-y-0.5 hover:bg-[#b0d360] active:translate-y-0"
              >
                {content.secondaryButtonText || "Iniciar consultoria com IA"}
              </Link>
              <Link
                href="/contact?requestType=conversao_propriedade_organica"
                className="rounded-full border border-[#123f2a]/20 bg-white px-7 py-3 text-sm font-bold text-[#123f2a] shadow-card transition hover:-translate-y-0.5 hover:border-[#123f2a]/50 active:translate-y-0"
              >
                Falar com especialista
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-[2rem] border border-white/80 bg-white/70 p-3 shadow-elevated backdrop-blur">
              <HomeHeroImage
                src={page.image_url}
                alt="Produção agrícola orgânica com tecnologia e orientação especializada no campo."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mx-auto max-w-[1280px] px-6 py-14 lg:px-10">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {premiumCards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-[#e7e2d9] bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#f2ede4] text-2xl">{card.icon}</span>
              <h2 className="mt-5 text-xl font-semibold text-[#002817]">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#414943]">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Steps section */}
      <section className="mx-auto max-w-[1280px] px-6 pb-16 lg:px-10">
        <div className="grid gap-8 rounded-2xl border border-[#e7e2d9] bg-white p-7 shadow-card lg:grid-cols-[0.9fr_1.1fr] lg:p-10">
          <div>
            <p className="label-md text-[#4d6700]">Agricultura orgânica primeiro</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#002817]">
              Da triagem digital ao plano de manejo sustentável
            </h2>
            <p className="mt-4 leading-7 text-[#414943]">
              O foco inicial é apoiar produtores interessados em sistemas orgânicos, hortaliças saudáveis, solo fértil e manejo integrado de pragas e doenças, sem perder a agilidade da tecnologia.
            </p>
            <Link
              href="/contact?requestType=visita_agricultura_organica"
              className="mt-6 inline-flex rounded-full bg-[#123f2a] px-6 py-3 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#002817]"
            >
              Solicitar avaliação pelo contato
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <article key={step.title} className="rounded-2xl border border-[#e7e2d9] bg-[#f8f3ea] p-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ccf078] text-sm font-bold text-[#123f2a]">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold text-[#002817]">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#414943]">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA section */}
      <section className="mx-auto max-w-[1280px] px-6 pb-20 lg:px-10">
        <div className="rounded-2xl bg-[#123f2a] p-7 text-white shadow-elevated md:p-10">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="label-md text-[#ccf078]">Próximo passo</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Organize seu caso e receba orientação com mais clareza.
              </h2>
              <p className="mt-3 max-w-3xl leading-7 text-white/75">
                As recomendações da IA são orientativas e não substituem avaliação agronômica presencial quando necessária. Casos críticos podem ser encaminhados para revisão humana especializada.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link
                href="/consultoria-ia"
                className="rounded-full bg-[#ccf078] px-6 py-3 text-center text-sm font-bold text-[#123f2a] transition hover:bg-[#b0d360]"
              >
                Iniciar consultoria com IA
              </Link>
              <Link
                href="/contact"
                className="rounded-full border border-white/30 px-6 py-3 text-center text-sm font-bold text-white transition hover:border-white/60 hover:bg-white/10"
              >
                Falar com especialista
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

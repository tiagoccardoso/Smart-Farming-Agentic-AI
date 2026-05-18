import Image from "next/image";
import Link from "next/link";

const steps = [
  {
    icon: "📷",
    title: "Envie o caso",
    description:
      "Adicione fotos da planta, folha, solo, praga, doença ou descreva o problema observado na lavoura."
  },
  {
    icon: "🤖",
    title: "Receba a análise da IA",
    description:
      "A IA gera uma análise inicial com hipóteses prováveis, nível de confiança, recomendações de manejo e alertas importantes."
  },
  {
    icon: "👩‍🌾",
    title: "Solicite revisão humana",
    description:
      "Quando o caso exigir maior segurança técnica, o produtor pode encaminhar a análise para revisão humana especializada."
  }
];

const analysisCards = [
  {
    icon: "🍃",
    title: "Doenças foliares",
    description: "Triagem visual de manchas, necroses, amarelecimento e outros sintomas comuns nas culturas."
  },
  {
    icon: "🧪",
    title: "Deficiências nutricionais",
    description: "Indícios visuais relacionados à nutrição da planta, solo, pH, macro e micronutrientes."
  },
  {
    icon: "🌦️",
    title: "Manejo da cultura",
    description:
      "Orientações iniciais sobre irrigação, adubação, clima, desenvolvimento da cultura e práticas de campo."
  },
  {
    icon: "🌱",
    title: "Análise de solo",
    description: "Interpretação básica de parâmetros do solo e recomendações preliminares de correção e adubação."
  },
  {
    icon: "✅",
    title: "Revisão humana especializada",
    description:
      "Complementação técnica por especialista quando houver incerteza, risco produtivo ou necessidade de análise mais detalhada."
  }
];

export default function HomePage() {
  return (
    <div className="bg-[#F6F1E8] text-[#1F2933]">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#E5F0D0_0%,#F6F1E8_42%,#FDFBF7_100%)]">
        <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-[#A7C957]/25 blur-3xl" />
        <div className="absolute bottom-10 right-10 h-80 w-80 rounded-full bg-[#2F80ED]/10 blur-3xl" />

        <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 md:flex-row md:items-center lg:py-24">
          <div className="flex-1">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#A7C957]/50 bg-white/85 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#123F2A] shadow-soft">
              🌾 Consultoria agrícola com IA + revisão humana especializada
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight text-[#123F2A] md:text-6xl">
              Diagnóstico agrícola rápido, com apoio de IA e validação técnica humana
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#1F2933]/80">
              Envie fotos da lavoura, folhas, solo ou sintomas da cultura. A IA gera uma análise inicial com hipóteses
              prováveis, recomendações de manejo e, quando necessário, encaminha o caso para revisão humana especializada.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/consultoria-ia"
                className="rounded-full bg-[#2E7D32] px-7 py-3 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#246528]"
              >
                Iniciar consultoria com IA
              </Link>
              <Link
                href="/revisao-humana"
                className="rounded-full border border-[#2E7D32]/30 bg-white px-7 py-3 text-sm font-bold text-[#123F2A] shadow-soft transition hover:-translate-y-0.5 hover:border-[#2E7D32]"
              >
                Solicitar revisão humana
              </Link>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[#1F2933]/70">
              Ideal para produtores, técnicos e consultores que precisam de uma primeira orientação rápida antes de tomar
              decisões no campo.
            </p>
          </div>

          <div className="flex-1">
            <div className="relative rounded-[2rem] border border-white/80 bg-white/70 p-3 shadow-soft backdrop-blur">
              <Image
                src="/images/agronoma-consultoria.svg"
                alt="Agrônoma no campo usando tablet para analisar uma planta"
                width={900}
                height={620}
                className="w-full rounded-[1.5rem]"
                priority
              />
              <div className="absolute left-6 top-6 rounded-2xl border border-[#A7C957]/60 bg-white/95 p-4 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2E7D32]">Análise IA concluída</p>
                <p className="mt-1 text-sm font-bold text-[#123F2A]">Hipótese provável: deficiência nutricional</p>
              </div>
              <div className="absolute bottom-6 right-6 max-w-[230px] rounded-2xl border border-[#2F80ED]/20 bg-white/95 p-4 shadow-soft">
                <p className="text-sm font-bold text-[#123F2A]">Confiança: média</p>
                <p className="mt-1 text-xs font-semibold text-[#2F80ED]">Revisão humana recomendada</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2E7D32]">Como funciona</p>
          <h2 className="mt-2 text-3xl font-bold text-[#123F2A]">Da triagem inicial à segurança da revisão especializada</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-3xl border border-[#123F2A]/10 bg-white p-6 shadow-soft">
              <div className="mb-5 flex items-center justify-between">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#A7C957]/25 text-2xl">
                  {step.icon}
                </span>
                <span className="text-sm font-bold text-[#A97142]">0{index + 1}</span>
              </div>
              <h3 className="text-xl font-bold text-[#123F2A]">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#1F2933]/70">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#2E7D32]">O que pode ser analisado</p>
          <h2 className="mt-2 text-3xl font-bold text-[#123F2A]">Consultoria orientativa para decisões no campo</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {analysisCards.map((card) => (
            <div key={card.title} className="rounded-3xl border border-[#123F2A]/10 bg-white p-6 shadow-soft">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F6F1E8] text-2xl">
                {card.icon}
              </div>
              <h3 className="text-xl font-bold text-[#123F2A]">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#1F2933]/70">{card.description}</p>
            </div>
          ))}
        </div>
      </section>


      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-8 rounded-3xl border border-[#2E7D32]/20 bg-white p-8 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-3xl font-bold text-[#123F2A]">Pensando em converter sua propriedade para produção orgânica?</h2>
            <p className="mt-3 text-[#1F2933]/80">Conte com orientação especializada para avaliar sua realidade, planejar o manejo e iniciar a transição com mais segurança.</p>
            <p className="mt-3 text-sm text-[#1F2933]/75">A agricultura orgânica pode abrir novas oportunidades de mercado, melhorar a sustentabilidade da produção e valorizar a propriedade.</p>
            <div className="mt-5 flex flex-wrap gap-3"><Link href="/agricultura-organica" className="rounded-full bg-[#2E7D32] px-6 py-3 text-sm font-bold text-white">Conhecer consultoria orgânica</Link><Link href="/contact?requestType=visita_agricultura_organica" className="rounded-full border border-[#2E7D32]/30 px-6 py-3 text-sm font-bold text-[#123F2A]">Falar pelo contato</Link></div>
          </div>
          <Image src="/images/organic-consulting-premium.svg" alt="Consultoria orgânica premium" width={800} height={500} className="w-full rounded-2xl" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl border border-[#2E7D32]/15 bg-[#123F2A] p-8 text-white shadow-soft md:p-10">
          <div className="grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#A7C957]">Próximo passo</p>
              <h2 className="mt-2 text-3xl font-bold">Comece com IA e evolua para revisão humana quando precisar.</h2>
              <p className="mt-4 leading-7 text-white/75">
                Organize fotos, sintomas e contexto da lavoura em um fluxo simples para receber recomendações preliminares
                e decidir com mais clareza.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link href="/consultoria-ia" className="rounded-full bg-[#A7C957] px-6 py-3 text-center text-sm font-bold text-[#123F2A]">
                Iniciar consultoria com IA
              </Link>
              <Link href="/revisao-humana" className="rounded-full border border-white/30 px-6 py-3 text-center text-sm font-bold text-white">
                Solicitar revisão humana
              </Link>
            </div>
          </div>
        </div>
        <p className="mt-6 rounded-2xl border border-[#A97142]/20 bg-white/70 p-4 text-sm leading-6 text-[#1F2933]/70">
          As recomendações da IA são orientativas e não substituem uma avaliação agronômica presencial quando necessária.
          Casos críticos podem ser encaminhados para revisão humana especializada.
        </p>
      </section>
    </div>
  );
}

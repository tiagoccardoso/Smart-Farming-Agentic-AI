import Image from "next/image";
import Link from "next/link";
import { getSitePage } from "../../lib/site-pages";

export const dynamic = "force-dynamic";

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export default async function Page() {
  const page = await getSitePage("agricultura-organica");
  const content = page.content ?? {};
  const benefits = asList(content.benefits);
  const challenges = asList(content.challenges);
  const steps = asList(content.steps);
  const services = asList(content.services);
  const image = page.image_url || "/images/organic-consulting-premium.svg";

  return <div className="bg-[#F6F1E8] px-4 py-8 sm:px-6 md:py-14">
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-8 rounded-[2rem] border border-[#123F2A]/15 bg-gradient-to-br from-white via-[#F8FCF7] to-[#EDF6ED] p-5 shadow-soft sm:p-7 md:p-11 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] sm:tracking-[0.18em] text-[#2E7D32]">Agricultura orgânica</p>
          <h1 className="mt-3 text-3xl font-bold text-[#123F2A] sm:text-4xl md:text-5xl">{page.title}</h1>
          <p className="mt-4 text-lg text-slate-700">{page.subtitle}</p>
          <p className="mt-4 leading-7 text-slate-700">{content.intro}</p>
          <Link href="/contact?requestType=conversao_propriedade_organica" className="mt-6 inline-block rounded-full bg-[#123F2A] px-7 py-3 font-semibold text-white shadow-soft">{content.ctaText || "Falar pelo contato"}</Link>
        </div>
        <div className="rounded-[2rem] border border-white bg-white/80 p-3 shadow-soft">
          {image.startsWith("/") ? (
            <Image src={image} alt="Especialista em agricultura orgânica avaliando hortaliças em uma propriedade rural com apoio de tecnologia." width={900} height={620} className="rounded-[1.5rem]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="Especialista em agricultura orgânica avaliando hortaliças em uma propriedade rural com apoio de tecnologia." className="rounded-[1.5rem]" />
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">O que é agricultura orgânica</h2><p className="mt-3 text-slate-700">É um sistema de produção baseado no equilíbrio do solo, biodiversidade e manejo sustentável, com menor dependência de insumos químicos sintéticos. Valoriza a saúde do solo, da água, das plantas e do consumidor, com planejamento e rastreabilidade.</p></section>
      <section className="grid gap-6 md:grid-cols-2"><article className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Benefícios para o produtor, solo e ambiente</h2><ul className="mt-4 space-y-2 text-slate-700">{benefits.map((b)=><li key={b}>• {b}</li>)}</ul></article><article className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Desafios da conversão</h2><ul className="mt-4 space-y-2 text-slate-700">{challenges.map((c)=><li key={c}>• {c}</li>)}</ul></article></section>
      <section className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Serviços oferecidos</h2><div className="mt-4 grid gap-3 text-slate-700 sm:grid-cols-2 lg:grid-cols-3">{services.map((i)=><div key={i} className="rounded-2xl border border-[#123F2A]/10 bg-[#F8FCF7] p-4">{i}</div>)}</div></section>
      <section className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Etapas para converter a propriedade</h2><ol className="mt-4 space-y-2 text-slate-700">{steps.map((step,i)=><li key={`${step}-${i}`}><span className="font-semibold text-[#2E7D32]">{i+1}.</span> {step}</li>)}</ol></section>
      <section className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7"><h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Agricultura orgânica para hortaliças</h2><p className="mt-3 text-slate-700">A consultoria contempla produção orgânica de hortaliças, tomateiro e melancia com foco em produção de mudas, tratos culturais, nutrição, fitossanidade, caldas alternativas e manejo integrado de pragas e doenças.</p></section>
      <section className="rounded-3xl border border-[#2E7D32]/20 bg-[#123F2A] p-5 text-white shadow-soft sm:p-7"><h2 className="text-2xl font-bold">Pronto para avaliar a conversão da sua propriedade?</h2><p className="mt-2 text-white/80">Solicite uma análise inicial e receba direcionamento técnico adequado ao seu contexto produtivo.</p><Link href="/contact?requestType=conversao_propriedade_organica" className="mt-5 inline-block rounded-full bg-[#A7C957] px-7 py-3 font-semibold text-[#123F2A]">{content.ctaText || "Falar pelo contato"}</Link></section>
    </div>
  </div>;
}

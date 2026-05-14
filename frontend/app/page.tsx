import Image from "next/image";
import Link from "next/link";
import FeatureCard from "../components/FeatureCard";
import MetricBadge from "../components/MetricBadge";
import SectionTitle from "../components/SectionTitle";

export default function HomePage() {
  return (
    <div>
      <section className="bg-hero-gradient">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-leaf-700 shadow-soft">
              🌾 IA leve para agricultura de precisão
            </p>
            <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
              Consultor Agrícola IA
            </h1>
            <p className="mt-4 text-lg text-slate-700">
              Tome decisões agrícolas com uma versão leve, em português, feita 100% em Next.js: recomendação de culturas,
              triagem visual de folhas e respostas rápidas sobre manejo.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link href="/crop" className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft">
                Recomendar cultura
              </Link>
              <Link href="/disease" className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft">
                Fazer triagem de folha
              </Link>
              <Link href="/qa" className="rounded-full border border-sun-200 bg-white px-6 py-3 text-sm font-semibold text-sun-700 shadow-soft">
                Fazer pergunta
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3">
              <MetricBadge label="Deploy" value="Vercel" />
              <MetricBadge label="Backend" value="Next.js" />
              <MetricBadge label="Idioma" value="pt-BR" />
            </div>
          </div>
          <div className="flex-1">
            <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-soft">
              <Image src="/images/crops.svg" alt="Ilustração de lavoura" width={640} height={360} className="mb-6 w-full rounded-2xl" priority />
              <div className="grid gap-4">
                <div className="rounded-2xl bg-white p-4 shadow-soft">
                  <p className="text-xs text-slate-500">Recomendação em tempo real</p>
                  <p className="mt-1 text-lg font-semibold text-leaf-800">Arroz • 86% de confiança</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-soft">
                  <p className="text-xs text-slate-500">Triagem visual</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">Possível doença foliar</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-soft">
                  <p className="text-xs text-slate-500">Assistente agrícola</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">“Irrigue tomates a cada 2 a 3 dias.”</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle title="Principais recursos" subtitle="Três ferramentas leves dentro do próprio Next.js." />
        <div className="grid gap-6 md:grid-cols-3">
          <FeatureCard
            icon="🌱"
            title="Recomendação de culturas"
            description="Sugere culturas usando regras agronômicas leves com nutrientes do solo, clima, pH e chuva."
          />
          <FeatureCard
            icon="🍃"
            title="Triagem de doenças"
            description="Recebe imagem da folha e orienta uma triagem inicial sem depender do antigo modelo pesado em Python."
          />
          <FeatureCard
            icon="🤖"
            title="Perguntas agrícolas"
            description="Responde dúvidas comuns com uma base local em TypeScript, pronta para rodar na Vercel."
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="gradient-card rounded-3xl p-10 shadow-soft">
          <SectionTitle
            title="Pronto para testar a versão leve?"
            subtitle="Use a recomendação de culturas, faça uma triagem visual ou consulte a base agrícola local."
          />
          <div className="flex flex-wrap gap-4">
            <Link href="/crop" className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft">
              Testar culturas
            </Link>
            <Link href="/disease" className="rounded-full bg-sun-500 px-6 py-3 text-sm font-semibold text-white shadow-soft">
              Testar folhas
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import SectionTitle from "../../components/SectionTitle";

const orientationCards = [
  {
    title: "Pergunte do seu jeito",
    description: "Conte o que está acontecendo na lavoura usando palavras simples, como cultura, fase da planta e sintomas vistos no campo.",
    icon: "💬"
  },
  {
    title: "Receba uma primeira direção",
    description: "A IA organiza as informações e sugere hipóteses, cuidados imediatos e próximos dados que podem ajudar no diagnóstico.",
    icon: "🌱"
  },
  {
    title: "Decida o próximo passo",
    description: "Se o caso precisar de maior segurança, você pode separar as informações para uma revisão técnica humana.",
    icon: "🧭"
  }
];

export default function ConsultoriaIAPage() {
  return (
    <div className="bg-hero-gradient">
      <section className="mx-auto max-w-6xl px-6 py-14 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700 shadow-soft">
              Consultoria agronômica com IA
            </p>
            <SectionTitle
              title="Consultoria IA"
              subtitle="Faça perguntas agrícolas e receba uma orientação inicial com IA."
            />
            <p className="max-w-2xl text-base leading-7 text-slate-700">
              Uma área simples para tirar dúvidas sobre manejo, sintomas, clima, solo e tomada de decisão no campo antes de abrir um caso completo.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/enviar-caso" className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700">
                Enviar caso completo
              </Link>
              <Link href="/revisao-humana" className="rounded-full border border-leaf-200 bg-white px-6 py-3 text-sm font-semibold text-leaf-700 shadow-soft hover:border-leaf-300">
                Ver revisão humana
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/85 p-6 shadow-soft">
            <p className="text-sm font-semibold text-slate-500">Exemplo de pergunta</p>
            <div className="mt-4 rounded-2xl bg-leaf-50 p-5 text-slate-700">
              “Minha soja está com manchas nas folhas depois de muita chuva. O que devo observar primeiro?”
            </div>
            <div className="mt-4 rounded-2xl bg-white p-5 text-sm leading-6 text-slate-600 shadow-soft">
              A resposta inicial pode listar possíveis causas, cuidados de segurança e quais fotos ou dados enviar para uma análise mais completa.
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {orientationCards.map((card) => (
            <article key={card.title} className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-leaf-100 text-2xl" aria-hidden>
                {card.icon}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

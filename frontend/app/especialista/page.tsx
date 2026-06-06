import Link from "next/link";
import { getSitePage } from "../../lib/site-pages";

export const dynamic = "force-dynamic";

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export default async function EspecialistaPage() {
  const page = await getSitePage("especialista");
  const content = page.content ?? {};
  const education = asList(content.education);
  const experiences = asList(content.experiences);
  const competencies = asList(content.competencies);

  return (
    <div className="bg-[#F6F1E8] px-4 py-8 sm:px-6 md:py-14">
      <div className="mx-auto max-w-6xl">
        <section className="grid gap-8 rounded-[2rem] border border-[#123F2A]/15 bg-gradient-to-br from-white via-[#F8FCF7] to-[#EEF6ED] p-5 shadow-soft sm:p-7 md:p-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div className="mx-auto w-full max-w-sm">
            {page.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.image_url} alt={`Foto profissional de ${page.title ?? "especialista"}`} className="aspect-[4/5] w-full rounded-[2rem] border border-white bg-white object-cover shadow-soft" />
            ) : (
              <div className="flex aspect-[4/5] w-full flex-col items-center justify-center rounded-[2rem] border border-[#123F2A]/10 bg-white text-center shadow-soft">
                <span className="text-6xl">👩‍🌾</span>
                <p className="mt-4 px-8 text-sm font-semibold text-[#123F2A]">Foto profissional da especialista</p>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2E7D32]">Revisão humana especializada</p>
            <h1 className="mt-3 text-3xl font-bold text-[#123F2A] sm:text-4xl md:text-5xl">{page.title}</h1>
            <p className="mt-3 text-xl font-semibold text-[#A97142]">{page.subtitle}</p>
            <p className="mt-4 text-lg text-[#123F2A]/85">{content.professionalTitle}</p>
            <p className="mt-5 max-w-4xl leading-7 text-slate-700">{content.summary}</p>
          </div>
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <article className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7">
            <h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Formação acadêmica</h2>
            <ul className="mt-4 space-y-3 text-slate-700">{education.map((item) => <li key={item}>• {item}</li>)}</ul>
          </article>
          <article className="rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7">
            <h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Competências</h2>
            <ul className="mt-4 grid gap-2 text-slate-700">{competencies.map((item) => <li key={item}>• {item}</li>)}</ul>
          </article>
        </section>

        <section className="mt-6 rounded-3xl border border-[#123F2A]/10 bg-white p-5 shadow-soft sm:p-7">
          <h2 className="text-xl font-bold text-[#123F2A] sm:text-2xl">Experiências relevantes</h2>
          <ul className="mt-4 grid gap-3 text-slate-700">{experiences.map((item) => <li key={item}>• {item}</li>)}</ul>
        </section>

        <section className="mt-6 rounded-3xl border border-[#2E7D32]/20 bg-[#123F2A] p-5 text-white shadow-soft sm:p-7">
          <h2 className="text-2xl font-bold">Atuação na Plantasã</h2>
          <p className="mt-4 leading-7 text-white/85">{content.platformText}</p>
          <p className="mt-3 leading-7 text-white/85">{content.ctaFinal}</p>
          <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
            <Link href="/enviar-caso" className="rounded-full bg-[#A7C957] px-6 py-3 text-sm font-semibold text-[#123F2A]">Enviar meu caso para revisão</Link>
            <Link href="/contact" className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold">Falar pelo formulário de contato</Link>
            <Link href="/agricultura-organica" className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold">Conhecer consultoria em agricultura orgânica</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

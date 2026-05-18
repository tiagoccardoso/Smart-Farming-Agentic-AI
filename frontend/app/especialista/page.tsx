import Link from "next/link";

const education = [
  "Engenharia Agronômica / Agronomia — UTFPR (Pato Branco, PR)",
  "Mestrado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)",
  "Doutorado em Agronomia / Produção Vegetal — UTFPR (Pato Branco, PR)",
];

const expertise = [
  "Agricultura orgânica e agroecologia",
  "Olericultura e produção de hortaliças",
  "Manejo da cultura do tomateiro",
  "Fitossanidade de hortaliças",
  "Manejo integrado de pragas e doenças",
  "Produção de mudas e tratos culturais",
  "Manejo de solo e sistemas sustentáveis",
  "Avaliação agronômica e relatórios técnicos",
];

export default function EspecialistaPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <section className="rounded-3xl border border-[#123F2A]/15 bg-gradient-to-br from-white via-[#F8FCF7] to-[#EEF6ED] p-8 md:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2E7D32]">Revisão humana especializada</p>
        <h1 className="mt-3 text-4xl font-bold text-[#123F2A] md:text-5xl">Conheça a especialista que pode revisar o seu caso</h1>
        <p className="mt-4 text-lg text-[#123F2A]/85">
          Consultoria agrícola com apoio de IA e revisão técnica humana conduzida por Engenheira Agrônoma e Doutora em Produção Vegetal.
        </p>
        <p className="mt-5 max-w-4xl leading-7 text-slate-700">
          Jessica Cardoso é Engenheira Agrônoma e Doutora em Produção Vegetal, com experiência em agricultura orgânica, olericultura, manejo da cultura do tomate, fitossanidade de hortaliças, agroecologia e experimentos de campo. Sua atuação combina conhecimento científico, experiência prática e orientação técnica para apoiar produtores na tomada de decisão.
        </p>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <article className="rounded-3xl border bg-white p-7">
          <h2 className="text-2xl font-bold text-[#123F2A]">Formação acadêmica</h2>
          <ul className="mt-4 space-y-3 text-slate-700">{education.map((item) => <li key={item}>• {item}</li>)}</ul>
        </article>
        <article className="rounded-3xl border bg-white p-7">
          <h2 className="text-2xl font-bold text-[#123F2A]">Áreas de atuação</h2>
          <ul className="mt-4 grid gap-2 text-slate-700">{expertise.map((item) => <li key={item}>• {item}</li>)}</ul>
        </article>
      </section>

      <section className="mt-6 rounded-3xl border bg-white p-7">
        <h2 className="text-2xl font-bold text-[#123F2A]">Experiência técnica e científica</h2>
        <ul className="mt-4 grid gap-3 text-slate-700">
          <li>• Pesquisa em doutorado com melhoramento genético de tomate e estudos com porta-enxertos alternativos para controle de <em>Meloidogyne javanica</em>.</li>
          <li>• Desenvolvimento e execução de experimentos de campo com tomateiro, com foco em produtividade, qualidade e adaptação a sistemas orgânicos.</li>
          <li>• Estágio curricular na Embrapa Agrobiologia (Seropédica, RJ), com vivência em produção sustentável e inovação agrícola.</li>
          <li>• Experiência com substratos orgânicos, iniciativas agroecológicas e implantação/acompanhamento de hortas orgânicas em escolas e comunidades.</li>
        </ul>
      </section>

      <section className="mt-6 rounded-3xl border bg-white p-7">
        <h2 className="text-2xl font-bold text-[#123F2A]">Experiência em docência e orientação</h2>
        <p className="mt-4 text-slate-700">Atuação em estágio de docência na disciplina de Olericultura e em atividades de laboratório de Botânica, com preparação de aulas práticas e suporte técnico a estudantes e produtores.</p>
        <ul className="mt-3 grid gap-2 text-slate-700 md:grid-cols-2">
          <li>• Hortaliças orgânicas e tratos culturais</li><li>• Cultivares, nutrição e fitossanidade</li><li>• Produção de mudas e manejo de tomateiro/melancia</li><li>• Caldas alternativas e manejo integrado de pragas e doenças</li>
        </ul>
      </section>

      <section className="mt-6 rounded-3xl border border-[#2E7D32]/20 bg-[#123F2A] p-7 text-white">
        <h2 className="text-2xl font-bold">Como ela atua na plataforma</h2>
        <ul className="mt-4 grid gap-2 text-white/85 md:grid-cols-2">
          <li>• Revisão de casos enviados pelos produtores</li><li>• Validação técnica de diagnósticos e recomendações</li><li>• Apoio em decisões sobre manejo, pragas, doenças e produção</li><li>• Orientação para produtores interessados em produção orgânica</li><li>• Apoio técnico na elaboração de relatórios e pareceres</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/enviar-caso" className="rounded-full bg-[#A7C957] px-6 py-3 text-sm font-semibold text-[#123F2A]">Enviar meu caso para revisão</Link>
          <Link href="/contact" className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold">Falar pelo formulário de contato</Link>
          <Link href="/agricultura-organica" className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold">Conhecer consultoria em agricultura orgânica</Link>
        </div>
      </section>
    </div>
  );
}

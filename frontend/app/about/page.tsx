import SectionTitle from "../../components/SectionTitle";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <SectionTitle title="Sobre a Plantasã" subtitle="Tecnologia, agronomia e revisão humana especializada para apoiar decisões no campo." />

      <div className="space-y-6 text-slate-700">
        <p>
          A Plantasã combina triagem inicial por inteligência artificial, organização de dados da lavoura e revisão técnica humana para apoiar produtores, técnicos e consultores em decisões agrícolas mais seguras.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Produção orgânica</h3>
            <p className="mt-2 text-sm">Apoio para conversão de propriedades, diagnóstico técnico e manejo sustentável de hortaliças.</p>
          </div>
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Triagem de doenças</h3>
            <p className="mt-2 text-sm">Orientação inicial para sintomas visuais, pragas, doenças e riscos produtivos.</p>
          </div>
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Revisão especializada</h3>
            <p className="mt-2 text-sm">Casos que exigem maior segurança podem receber avaliação humana conduzida por especialista.</p>
          </div>
        </div>

        <div className="rounded-2xl bg-[#123F2A] p-6 text-white">
          <h4 className="text-lg font-semibold">Como a plataforma atua</h4>
          <p className="mt-2 text-sm text-white/80">
            O produtor envia dados e imagens, a IA organiza uma primeira análise orientativa e a especialista pode complementar a recomendação quando o caso exige validação técnica.
          </p>
        </div>

        <div className="rounded-2xl border border-sun-200 bg-sun-50 p-6">
          <h4 className="text-lg font-semibold text-slate-900">Limitações</h4>
          <p className="mt-2 text-sm">
            As recomendações são orientativas e devem ser validadas com análise de solo, dados locais e apoio de um profissional de agronomia antes de decisões de grande impacto produtivo.
          </p>
        </div>
      </div>
    </div>
  );
}

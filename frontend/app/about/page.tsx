import SectionTitle from "../../components/SectionTitle";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <SectionTitle title="Sobre o Consultor Agrícola IA" subtitle="Uma versão leve, em português, feita para rodar 100% em Next.js." />

      <div className="space-y-6 text-slate-700">
        <p>
          O Consultor Agrícola IA foi simplificado para funcionar sem backend Flask, sem PyTorch local e sem arquivos grandes de
          modelo. Agora, as rotas internas do Next.js cuidam da recomendação de culturas, da triagem visual e das perguntas agrícolas.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Recomendação de culturas</h3>
            <p className="mt-2 text-sm">Usa regras leves com NPK, clima, pH, chuva e indicadores derivados.</p>
          </div>
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Triagem de doenças</h3>
            <p className="mt-2 text-sm">Orienta uma avaliação inicial da folha sem executar o antigo modelo pesado em Python.</p>
          </div>
          <div className="rounded-2xl border border-leaf-100 bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-900">Perguntas agrícolas</h3>
            <p className="mt-2 text-sm">Busca respostas em uma base local de conhecimento em TypeScript.</p>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900 p-6 text-white">
          <h4 className="text-lg font-semibold">Arquitetura simplificada</h4>
          <p className="mt-2 text-sm text-slate-200">
            Usuário → Next.js App Router → Route Handlers internos → regras leves / base local → resposta em português.
          </p>
        </div>

        <div className="rounded-2xl border border-sun-200 bg-sun-50 p-6">
          <h4 className="text-lg font-semibold text-slate-900">Limitações</h4>
          <p className="mt-2 text-sm">
            Esta versão prioriza leveza e facilidade de deploy. As recomendações são orientativas e devem ser validadas com análise de
            solo, dados locais e apoio de um profissional de agronomia antes de decisões de grande escala.
          </p>
        </div>
      </div>
    </div>
  );
}

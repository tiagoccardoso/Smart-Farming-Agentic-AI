import SectionTitle from "../../components/SectionTitle";

export default function ModelsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-14">
      <SectionTitle title="Modelos e dados" subtitle="Entenda como a versão leve gera as respostas." />

      <div className="space-y-6 text-slate-700">
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold">Recomendação de culturas</h3>
          <p className="mt-2 text-sm">
            O antigo modelo Python foi substituído por regras em TypeScript com faixas ideais para NPK, temperatura,
            umidade, pH e chuva. É leve, transparente e roda nas rotas internas do Next.js.
          </p>
        </div>
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold">Triagem de doenças</h3>
          <p className="mt-2 text-sm">
            A detecção pesada com ResNet50 foi removida do fluxo principal. A versão atual oferece triagem orientativa,
            hipóteses iniciais e próximos passos para avaliação no campo.
          </p>
        </div>
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold">Perguntas agrícolas</h3>
          <p className="mt-2 text-sm">
            O RAG com FAISS foi trocado por uma base local em TypeScript com busca por termos relevantes. Isso mantém o
            projeto simples para Vercel e deixa espaço para integrar embeddings externos no futuro.
          </p>
        </div>
        <div className="rounded-2xl bg-sun-50 p-6">
          <h4 className="text-base font-semibold">Caminho de evolução</h4>
          <p className="mt-2 text-sm">
            Se desejar mais precisão, a aplicação pode chamar APIs externas de visão, LLMs ou bancos vetoriais mantendo o
            frontend e as rotas no ecossistema Next.js.
          </p>
        </div>
      </div>
    </div>
  );
}

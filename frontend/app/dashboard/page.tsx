import SectionTitle from "../../components/SectionTitle";
import ResultCard from "../../components/ResultCard";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle title="Painel de resultados" subtitle="Resumo demonstrativo das orientações e registros da plataforma." />

      <div className="grid gap-6 md:grid-cols-2">
        <ResultCard title="Última recomendação" description="Arroz • 86% de confiança • Alta umidade e boa chuva" />
        <ResultCard title="Última triagem visual" description="Possível doença foliar • orientação inicial gerada" />
        <ResultCard title="Última pergunta" description="Tomateiros: manter umidade constante e evitar encharcamento." />
        <ResultCard title="Saúde do sistema" description="Fluxos de consultoria, triagem e relatórios operacionais disponíveis." />
      </div>

      <div className="mt-8 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <h4 className="text-base font-semibold text-[#1d1c16]">Observações</h4>
        <p className="mt-2 text-sm text-[#414943]">
          Este painel é demonstrativo. Em futuras versões, pode ser conectado a um banco de dados para histórico real,
          autenticação, relatórios por propriedade e exportação dos resultados.
        </p>
      </div>
    </div>
  );
}

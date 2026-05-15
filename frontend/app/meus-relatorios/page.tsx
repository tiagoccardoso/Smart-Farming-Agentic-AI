import SectionTitle from "../../components/SectionTitle";
import ResultCard from "../../components/ResultCard";

export default function MeusRelatoriosPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle
        title="Meus Relatórios"
        subtitle="Histórico privado de consultorias, casos enviados e pareceres técnicos da plataforma."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <ResultCard title="Consultorias IA" description="Relatórios orientativos gerados pela inteligência artificial." />
        <ResultCard title="Casos enviados" description="Acompanhamento dos casos submetidos para análise agronômica." />
        <ResultCard title="Pareceres humanos" description="Recomendações revisadas por doutora ou especialista habilitada." />
      </div>
    </div>
  );
}

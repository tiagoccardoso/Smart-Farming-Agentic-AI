import SectionTitle from "../../components/SectionTitle";

export default function RevisaoHumanaPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <SectionTitle
        title="Revisão Humana"
        subtitle="Acompanhe casos enviados para validação por especialista e veja o status da análise agronômica."
      />

      <div className="space-y-4 rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        {[
          "Caso recebido",
          "Em revisão pela especialista",
          "Aguardando informações complementares",
          "Parecer técnico disponível"
        ].map((step) => (
          <div key={step} className="flex items-center gap-3 rounded-2xl bg-leaf-50 p-4 text-sm text-slate-700">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-leaf-600 text-white">✓</span>
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

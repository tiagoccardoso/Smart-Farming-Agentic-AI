import SectionTitle from "../../components/SectionTitle";

export default function ConsultoriaIAPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <SectionTitle
        title="Consultoria IA"
        subtitle="Receba uma orientação agronômica inicial com IA antes de decidir se precisa enviar o caso para revisão humana."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold text-slate-900">Triagem orientativa</h3>
          <p className="mt-2 text-sm text-slate-600">
            Descreva cultura, sintomas, solo, clima e manejo para receber hipóteses iniciais e próximos passos.
          </p>
        </div>
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold text-slate-900">Base agronômica</h3>
          <p className="mt-2 text-sm text-slate-600">
            A resposta deve combinar conhecimento agrícola, contexto do produtor e alertas de segurança para decisões de campo.
          </p>
        </div>
        <div className="rounded-2xl border border-sun-200 bg-sun-50 p-6 shadow-soft">
          <h3 className="text-lg font-semibold text-slate-900">Próximo passo</h3>
          <p className="mt-2 text-sm text-slate-600">
            Casos críticos podem ser encaminhados para análise de uma doutora ou especialista agronômica.
          </p>
        </div>
      </div>
    </div>
  );
}

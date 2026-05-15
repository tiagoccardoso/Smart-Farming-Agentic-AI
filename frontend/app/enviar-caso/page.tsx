import SectionTitle from "../../components/SectionTitle";

export default function EnviarCasoPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <SectionTitle
        title="Enviar Caso"
        subtitle="Organize informações da lavoura, imagens e histórico de manejo para análise orientativa e futura revisão humana."
      />

      <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-leaf-50 p-5">
            <h3 className="font-semibold text-slate-900">Dados do cultivo</h3>
            <p className="mt-2 text-sm text-slate-600">Cultura, localização, talhão, estágio da planta e objetivo do atendimento.</p>
          </div>
          <div className="rounded-2xl bg-leaf-50 p-5">
            <h3 className="font-semibold text-slate-900">Sintomas e evidências</h3>
            <p className="mt-2 text-sm text-slate-600">Descrição do problema, fotos, manejo recente, irrigação e condições climáticas.</p>
          </div>
          <div className="rounded-2xl bg-sun-50 p-5 md:col-span-2">
            <h3 className="font-semibold text-slate-900">Fluxo previsto</h3>
            <p className="mt-2 text-sm text-slate-600">
              O caso será salvo, receberá uma análise inicial por IA e poderá ser enviado para revisão humana conforme o plano do usuário.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

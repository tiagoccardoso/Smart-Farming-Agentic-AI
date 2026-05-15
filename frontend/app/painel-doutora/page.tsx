import SectionTitle from "../../components/SectionTitle";

export default function PainelDoutoraPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle
        title="Painel da Doutora"
        subtitle="Área restrita para especialistas revisarem casos, solicitarem dados adicionais e publicarem pareceres técnicos."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <p className="text-sm text-slate-500">Fila de revisão</p>
          <p className="mt-2 text-3xl font-semibold text-leaf-700">0</p>
        </div>
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <p className="text-sm text-slate-500">Aguardando informações</p>
          <p className="mt-2 text-3xl font-semibold text-sun-600">0</p>
        </div>
        <div className="rounded-2xl border border-leaf-100 bg-white p-6 shadow-soft">
          <p className="text-sm text-slate-500">Pareceres concluídos</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">0</p>
        </div>
      </div>
    </div>
  );
}

import SectionTitle from "../../components/SectionTitle";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <SectionTitle title="Contato e feedback" subtitle="Compartilhe sugestões ou peça novos recursos." />

      <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
        <form className="grid gap-4">
          <label className="text-sm text-slate-700">
            Nome
            <input className="mt-2 w-full rounded-xl border border-leaf-100 px-4 py-2 shadow-soft" placeholder="Seu nome" />
          </label>
          <label className="text-sm text-slate-700">
            E-mail
            <input className="mt-2 w-full rounded-xl border border-leaf-100 px-4 py-2 shadow-soft" placeholder="voce@email.com" />
          </label>
          <label className="text-sm text-slate-700">
            Mensagem
            <textarea
              className="mt-2 w-full rounded-xl border border-leaf-100 px-4 py-2 shadow-soft"
              rows={5}
              placeholder="Conte como foi sua experiência..."
            />
          </label>
          <button className="rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft">
            Enviar feedback
          </button>
        </form>
      </div>
    </div>
  );
}

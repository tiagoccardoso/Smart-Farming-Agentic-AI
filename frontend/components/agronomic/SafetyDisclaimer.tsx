const SAFETY_DISCLAIMER_TEXT =
  "As orientações geradas por IA são informativas e não substituem a avaliação de um profissional habilitado. Para decisões técnicas, aplicações de defensivos, laudos ou recomendações com responsabilidade profissional, solicite revisão humana.";

type SafetyDisclaimerProps = {
  className?: string;
};

export default function SafetyDisclaimer({ className = "" }: SafetyDisclaimerProps) {
  return (
    <div className={`rounded-2xl border border-gold-200 bg-gold-50 p-5 text-sm leading-6 text-gold-900 shadow-inner-soft ${className}`} role="note">
      <p className="font-bold text-moss-800">Aviso de segurança e responsabilidade</p>
      <p className="mt-2">{SAFETY_DISCLAIMER_TEXT}</p>
    </div>
  );
}

export { SAFETY_DISCLAIMER_TEXT };

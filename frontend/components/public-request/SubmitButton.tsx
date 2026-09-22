import { primaryButtonClass } from "./styles";

type Props = {
  label: string;
  submitting: boolean;
  progress: number | null;
  disabled?: boolean;
};

export default function SubmitButton({ label, submitting, progress, disabled = false }: Props) {
  const percent = progress === null ? null : Math.round(progress * 100);
  const text = !submitting ? label : percent !== null && percent < 100 ? `Enviando... ${percent}%` : "Enviando...";

  return (
    <button type="submit" disabled={submitting || disabled} aria-busy={submitting} className={primaryButtonClass}>
      {submitting ? (
        percent !== null ? (
          <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-300" style={{ width: `${percent}%` }} aria-hidden="true" />
        ) : (
          <span className="absolute inset-y-0 left-0 animate-[submitProgress_1.2s_ease-in-out_infinite] bg-white/20" aria-hidden="true" />
        )
      ) : null}
      <span className="relative">{text}</span>
    </button>
  );
}

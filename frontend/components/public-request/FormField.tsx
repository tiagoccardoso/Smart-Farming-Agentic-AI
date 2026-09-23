import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

type Props = {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  /** Mensagem de erro do campo: exibida abaixo dele e associada via aria-describedby. */
  error?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Label + campo + dica/erro, no padrao visual dos formularios publicos. Dica e
 * erro ficam fora do nome acessivel do campo e sao associados via
 * aria-describedby; com erro, o campo recebe aria-invalid.
 */
export default function FormField({ label, required = false, hint, error, className = "", children }: Props) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  const control =
    describedBy && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>, {
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined
        })
      : children;

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <label className="block">
        <span className="text-sm font-semibold text-slate-800">
          {label}
          {required ? <span className="text-red-700" aria-hidden="true"> *</span> : null}
        </span>
        {control}
      </label>
      {error ? (
        <span id={errorId} className="mt-1.5 block text-xs font-semibold leading-5 text-red-700">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="mt-1.5 block text-xs leading-5 text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

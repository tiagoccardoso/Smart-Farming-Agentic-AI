import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

type Props = {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * Label + campo + dica, no padrao visual dos formularios publicos. A dica fica
 * fora do nome acessivel do campo e e associada via aria-describedby.
 */
export default function FormField({ label, required = false, hint, className = "", children }: Props) {
  const hintId = useId();
  const control =
    hint && isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": hintId }) : children;

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <label className="block">
        <span className="text-sm font-semibold text-slate-800">
          {label}
          {required ? <span className="text-red-700" aria-hidden="true"> *</span> : null}
        </span>
        {control}
      </label>
      {hint ? (
        <span id={hintId} className="mt-1.5 block text-xs leading-5 text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

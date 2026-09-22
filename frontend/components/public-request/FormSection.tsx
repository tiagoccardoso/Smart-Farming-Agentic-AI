import type { ReactNode } from "react";
import { sectionTitleClass } from "./styles";

type Props = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export default function FormSection({ title, description, children }: Props) {
  return (
    <div className="min-w-0 border-t border-leaf-100 pt-6 first:border-t-0 first:pt-0">
      <fieldset className="min-w-0">
        <legend className={`p-0 ${sectionTitleClass}`}>{title}</legend>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
        <div className="mt-4 grid gap-4">{children}</div>
      </fieldset>
    </div>
  );
}

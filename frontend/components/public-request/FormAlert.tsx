import { forwardRef, type ReactNode } from "react";

type Props = { tone: "success" | "error" | "info"; title?: string; children: ReactNode };

const toneClass = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-slate-200 bg-slate-50 text-slate-600"
};

const FormAlert = forwardRef<HTMLDivElement, Props>(function FormAlert({ tone, title, children }, ref) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-2xl border p-4 text-sm leading-6 outline-none ${toneClass[tone]}`}
    >
      {title ? <p className="font-bold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
});

export default FormAlert;

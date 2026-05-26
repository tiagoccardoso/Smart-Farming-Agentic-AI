import Link from "next/link";

export type WorkflowStep = {
  title: string;
  description: string;
  href?: string;
  status?: "done" | "current" | "next";
};

type WorkflowStepperProps = {
  steps: WorkflowStep[];
  className?: string;
};

const statusClasses = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  current: "border-leaf-300 bg-leaf-50 text-leaf-800 ring-2 ring-leaf-100",
  next: "border-[#e7e2d9] bg-white text-[#414943]"
};

const statusLabels = {
  done: "Concluído",
  current: "Etapa atual",
  next: "Próximo"
};

export default function WorkflowStepper({ steps, className = "" }: WorkflowStepperProps) {
  return (
    <div className={`rounded-3xl border border-leaf-100 bg-white p-4 shadow-soft md:p-5 ${className}`}>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-4 xl:grid-cols-5">
        {steps.map((step, index) => {
          const status = step.status ?? "next";
          const content = (
            <div className={`h-full rounded-2xl border p-4 transition ${statusClasses[status]}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold shadow-soft">
                  {index + 1}
                </span>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                  {statusLabels[status]}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-[#1d1c16]">{step.title}</p>
              <p className="mt-1 text-xs leading-5 text-[#414943]">{step.description}</p>
            </div>
          );

          return step.href ? (
            <Link key={`${step.title}-${index}`} href={step.href} className="block focus:outline-none focus:ring-2 focus:ring-leaf-300">
              {content}
            </Link>
          ) : (
            <div key={`${step.title}-${index}`}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}

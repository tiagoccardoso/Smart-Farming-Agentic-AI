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
  current: "border-leaf-300 bg-leaf-50 text-leaf-900 ring-2 ring-leaf-100",
  next: "border-paper-200 bg-white text-slate-600",
};

const statusLabels = {
  done: "Concluído",
  current: "Etapa atual",
  next: "Próximo",
};

export default function WorkflowStepper({ steps, className = "" }: WorkflowStepperProps) {
  return (
    <div className={`rounded-[2rem] border border-paper-200 bg-white/90 p-4 shadow-soft md:p-5 ${className}`}>
      <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:overflow-visible md:pb-0 xl:grid-cols-5">
        {steps.map((step, index) => {
          const status = step.status ?? "next";
          const content = (
            <div className={`h-full min-w-64 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-tactile md:min-w-0 ${statusClasses[status]}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-moss-800 shadow-inner-soft ring-1 ring-paper-200">
                  {index + 1}
                </span>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                  {statusLabels[status]}
                </span>
              </div>
              <p className="mt-3 text-sm font-bold text-slate-900">{step.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{step.description}</p>
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

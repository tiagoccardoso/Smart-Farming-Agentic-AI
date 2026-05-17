import type { ReactNode } from "react";
import type { AgronomicRiskLevel } from "../../lib/agronomic/case";

const riskLabels: Record<AgronomicRiskLevel, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto"
};

const riskStyles: Record<AgronomicRiskLevel, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800"
};

const statusTone: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  submitted: "border-sky-200 bg-sky-50 text-sky-800",
  ai_analyzed: "border-leaf-200 bg-leaf-50 text-leaf-800",
  pending_payment: "border-amber-200 bg-amber-50 text-amber-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  waiting_review: "border-purple-200 bg-purple-50 text-purple-800",
  waiting_human_review: "border-purple-200 bg-purple-50 text-purple-800",
  in_review: "border-indigo-200 bg-indigo-50 text-indigo-800",
  reviewed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  human_reviewed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900",
  rejected: "border-red-200 bg-red-50 text-red-800"
};

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

export function RiskBadge({ riskLevel, fallback = "Risco não definido" }: { riskLevel?: AgronomicRiskLevel | null; fallback?: string }) {
  if (!riskLevel) {
    return <Badge className="border-slate-200 bg-slate-50 text-slate-600">{fallback}</Badge>;
  }

  return <Badge className={riskStyles[riskLevel]}>Risco {riskLabels[riskLevel]}</Badge>;
}

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalizedStatus = status ?? "";
  return <Badge className={statusTone[normalizedStatus] ?? "border-slate-200 bg-slate-50 text-slate-700"}>{label ?? (normalizedStatus || "Sem status")}</Badge>;
}

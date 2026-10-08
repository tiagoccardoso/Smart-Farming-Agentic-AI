import { IconAlert, IconCheck, IconClock } from "./icons";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "partial" | "error";

/**
 * Indicador do estado real do salvamento. "Salvo" só aparece depois que o
 * servidor confirmou (ver lib/agronomic/case-save.ts).
 */
export default function SaveStatus({ state, message }: { state: SaveState; message?: string | null }) {
  if (state === "idle") return <span className="text-sm text-slate-500">Nenhuma alteração pendente</span>;

  const config = {
    dirty: { className: "text-amber-800", icon: <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />, label: "Alterações não salvas" },
    saving: { className: "text-sky-800", icon: <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" aria-hidden="true" />, label: "Salvando alterações..." },
    saved: { className: "text-emerald-800", icon: <IconCheck className="h-4 w-4" />, label: "Alterações salvas com sucesso" },
    partial: { className: "text-amber-900", icon: <IconClock className="h-4 w-4" />, label: "Salvo parcialmente" },
    error: { className: "text-red-800", icon: <IconAlert className="h-4 w-4" />, label: "Não foi possível salvar. Tente novamente." },
  }[state];

  return (
    <div role="status" aria-live="polite" className={`flex min-w-0 items-start gap-2 text-sm font-semibold ${config.className}`} data-testid="save-status" data-state={state}>
      <span className="mt-0.5 flex h-4 w-4 items-center justify-center">{config.icon}</span>
      <span className="min-w-0">
        {state === "error" && message ? message : config.label}
        {state === "partial" && message ? <span className="block font-normal">{message}</span> : null}
      </span>
    </div>
  );
}

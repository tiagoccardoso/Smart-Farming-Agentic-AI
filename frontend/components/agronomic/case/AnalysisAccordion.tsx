"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { splitAiResponseIntoBlocks } from "../../../lib/agronomic/ai-response-formatting";
import {
  buildAnalysisSections,
  splitReferenceMarkers,
  type AnalysisReference,
  type AnalysisSection,
  type AnalysisSectionId,
  type BuildAnalysisSectionsInput,
  type SectionBlock,
} from "../../../lib/agronomic/analysis-sections";
import {
  IconBook,
  IconChevron,
  IconExternal,
  IconFlask,
  IconLeaf,
  IconSearch,
  IconShield,
  IconSteps,
  IconSummary,
  IconTractor,
} from "./icons";

const SECTION_ICONS: Record<AnalysisSectionId, (props: { className?: string }) => JSX.Element> = {
  summary: IconSummary,
  symptoms: IconLeaf,
  causes: IconSearch,
  technical: IconFlask,
  management: IconTractor,
  prevention: IconShield,
  "next-steps": IconSteps,
  sources: IconBook,
};

const toneClass = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800",
  neutral: "border-slate-200 bg-white text-slate-700",
} as const;

function TextWithReferences({ text, references, idPrefix }: { text: string; references: AnalysisReference[]; idPrefix: string }) {
  const parts = splitReferenceMarkers(text, references.length);
  return (
    <>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.value}</span>
        ) : (
          <a
            key={index}
            href={`#${idPrefix}-ref-${part.index}`}
            onClick={(event) => {
              // Abre a seção de fontes sem rolar a página inteira.
              event.preventDefault();
              document.dispatchEvent(new CustomEvent(`${idPrefix}:open-ref`, { detail: part.index }));
            }}
            className="ml-0.5 inline-flex min-w-[1.4rem] items-center justify-center rounded-md bg-leaf-50 px-1 align-super text-[0.7rem] font-bold leading-4 text-leaf-800 ring-1 ring-leaf-200 hover:bg-leaf-100"
            aria-label={`Ver referência ${part.index}`}
          >
            {part.index}
          </a>
        ),
      )}
    </>
  );
}

function RichText({ text, references, idPrefix }: { text: string; references: AnalysisReference[]; idPrefix: string }) {
  const blocks = splitAiResponseIntoBlocks(text);
  return (
    <div className="space-y-3 break-words text-[0.95rem] leading-7 text-slate-700">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <p key={index} className="pt-1 text-sm font-bold uppercase tracking-wide text-slate-500">{block.text}</p>;
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2.5">
                  <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-600" aria-hidden="true" />
                  <span><TextWithReferences text={item} references={references} idPrefix={idPrefix} /></span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={index}><TextWithReferences text={block.text} references={references} idPrefix={idPrefix} /></p>;
      })}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

function Block({ block, references, idPrefix }: { block: SectionBlock; references: AnalysisReference[]; idPrefix: string }) {
  if (block.type === "text") {
    return (
      <div>
        {block.label ? <Label>{block.label}</Label> : null}
        <RichText text={block.text} references={references} idPrefix={idPrefix} />
      </div>
    );
  }

  if (block.type === "list") {
    const dot = block.tone === "warning" ? "bg-amber-500" : block.tone === "positive" ? "bg-leaf-600" : "bg-slate-400";
    return (
      <div>
        {block.label ? <Label>{block.label}</Label> : null}
        <ul className="space-y-2.5 text-[0.95rem] leading-7 text-slate-700">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2.5">
              <span className={`mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
              <span className="min-w-0 break-words"><TextWithReferences text={item} references={references} idPrefix={idPrefix} /></span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.type === "facts") {
    return (
      <dl className="flex flex-wrap gap-2">
        {block.items.map((item) => (
          <div key={item.label} className={`rounded-xl border px-3 py-1.5 ${toneClass[item.tone ?? "neutral"]}`}>
            <dt className="text-[0.68rem] font-bold uppercase tracking-wide opacity-70">{item.label}</dt>
            <dd className="text-sm font-bold">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (block.type === "note") {
    const tone =
      block.tone === "warning"
        ? "border-amber-200 bg-amber-50/70 text-amber-900"
        : block.tone === "info"
          ? "border-sky-200 bg-sky-50/70 text-sky-900"
          : "border-slate-200 bg-slate-50 text-slate-600";
    return <p className={`rounded-xl border px-3.5 py-2.5 text-sm leading-6 ${tone}`}>{block.text}</p>;
  }

  if (block.type === "hypotheses") {
    return (
      <ol className="space-y-3">
        {block.items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-bold text-slate-900">
                <span className="mr-1.5 text-slate-400">{index + 1}.</span>
                {item.name}
              </p>
              {item.probabilityLabel ? (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${toneClass[item.probability ?? "neutral"]}`}>{item.probabilityLabel}</span>
              ) : null}
            </div>
            {item.justification ? (
              <div className="mt-2">
                <RichText text={item.justification} references={references} idPrefix={idPrefix} />
              </div>
            ) : null}
            {item.favorableFactors.length || item.uncertaintyFactors.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {item.favorableFactors.length ? (
                  <div className="rounded-xl bg-leaf-50/70 p-3">
                    <Label>O que sustenta</Label>
                    <ul className="space-y-1.5 text-sm leading-6 text-slate-700">
                      {item.favorableFactors.map((factor, i) => <li key={i}>• <TextWithReferences text={factor} references={references} idPrefix={idPrefix} /></li>)}
                    </ul>
                  </div>
                ) : null}
                {item.uncertaintyFactors.length ? (
                  <div className="rounded-xl bg-amber-50/70 p-3">
                    <Label>O que falta confirmar</Label>
                    <ul className="space-y-1.5 text-sm leading-6 text-slate-700">
                      {item.uncertaintyFactors.map((factor, i) => <li key={i}>• <TextWithReferences text={factor} references={references} idPrefix={idPrefix} /></li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {item.potentialImpact ? (
              <p className="mt-3 text-sm leading-6 text-slate-600"><strong className="text-slate-800">Impacto possível:</strong> <TextWithReferences text={item.potentialImpact} references={references} idPrefix={idPrefix} /></p>
            ) : null}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className="space-y-2.5">
      {block.items.map((reference) => (
        <li key={reference.index} id={`${idPrefix}-ref-${reference.index}`} tabIndex={-1} className="flex scroll-mt-28 outline-none gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-700">{reference.index}</span>
          <div className="min-w-0 text-sm leading-6">
            {reference.url ? (
              <a href={reference.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 break-words font-semibold text-leaf-800 underline-offset-4 hover:underline">
                <span className="min-w-0 break-words">{reference.title}</span>
                <IconExternal className="mt-1 h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="font-semibold text-slate-800">{reference.title}</p>
            )}
            <p className="text-xs text-slate-500">
              {reference.origin === "internet" ? "Pesquisa externa" : reference.origin === "internal" ? reference.detail || "Base técnica interna" : "Citada na resposta da IA"}
              {reference.url ? ` · ${reference.url.replace(/^https?:\/\//, "").split("/")[0]}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function AccordionItem({
  section,
  open,
  onToggle,
  references,
  idPrefix,
}: {
  section: AnalysisSection;
  open: boolean;
  onToggle: () => void;
  references: AnalysisReference[];
  idPrefix: string;
}) {
  const Icon = SECTION_ICONS[section.id];
  const panelId = `${idPrefix}-${section.id}-panel`;
  const buttonId = `${idPrefix}-${section.id}-button`;
  return (
    <div className={`overflow-hidden rounded-2xl border transition-colors ${open ? "border-leaf-200 bg-white" : "border-slate-200 bg-white/80"}`}>
      <h4 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-3 text-left hover:bg-leaf-50/50"
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${open ? "bg-leaf-100 text-leaf-800" : "bg-slate-100 text-slate-600"}`}>
            <Icon className="h-[1.1rem] w-[1.1rem]" />
          </span>
          <span className="min-w-0 flex-1 text-[0.98rem] font-bold text-slate-900">{section.title}</span>
          {section.count ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{section.count}</span> : null}
          <IconChevron className={`h-5 w-5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </h4>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} references={references} idPrefix={idPrefix} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AnalysisAccordion(props: BuildAnalysisSectionsInput) {
  const idPrefix = `analise-${useId().replace(/:/g, "")}`;
  const { sections, references } = useMemo(
    () => buildAnalysisSections(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.analysis, props.reportedSymptoms, props.pendingQuestions, props.legacySummary, props.legacyRecommendation, props.legacyRiskLevel],
  );
  const [openIds, setOpenIds] = useState<Set<AnalysisSectionId>>(() => new Set(sections.filter((section) => section.defaultOpen).map((section) => section.id)));

  const toggle = (id: AnalysisSectionId) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Clique em [n]: abre "Fontes e referências" e destaca a fonte, sem rolar a página.
  useEffect(() => {
    const handler = (event: Event) => {
      const index = (event as CustomEvent<number>).detail;
      setOpenIds((current) => new Set(current).add("sources"));
      window.setTimeout(() => {
        const element = document.getElementById(`${idPrefix}-ref-${index}`);
        if (!element) return;
        element.classList.add("ring-2", "ring-leaf-400");
        window.setTimeout(() => element.classList.remove("ring-2", "ring-leaf-400"), 1800);
        element.focus?.();
      }, 30);
    };
    document.addEventListener(`${idPrefix}:open-ref`, handler);
    return () => document.removeEventListener(`${idPrefix}:open-ref`, handler);
  }, [idPrefix]);

  if (!sections.length) return null;

  return (
    <div className="space-y-2.5" data-testid="analysis-accordion">
      {sections.map((section) => (
        <AccordionItem key={section.id} section={section} open={openIds.has(section.id)} onToggle={() => toggle(section.id)} references={references} idPrefix={idPrefix} />
      ))}
    </div>
  );
}

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import type {
  MatchClassification,
} from "@/lib/matching/types";

const classificationLabel: Record<MatchClassification, string> = {
  compatible: "Compatibile",
  almost_compatible: "Buona alternativa",
  weak: "Da valutare",
  not_relevant: "Poco adatto",
};

export function MatchCard({
  match,
  counterpartHref,
  counterpartTitle,
  detailHref,
}: Readonly<{
  match: {
    id: string;
    score: number;
    classification: MatchClassification;
    matched_criteria?: string[];
    missing_preferences?: string[];
    conflicting_criteria?: string[];
    explanation?: string;
  };
  counterpartHref: string;
  counterpartTitle: string;
  detailHref?: string;
}>) {
  const positive = match.matched_criteria ?? [];
  const conflicts = match.conflicting_criteria ?? [];

  return (
    <article className="group/match overflow-hidden rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)] transition-colors hover:border-[var(--lr-line)]">
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-[8px] ${
              match.classification === "compatible"
                ? "bg-[var(--lr-accent-soft)] text-[var(--lr-accent)]"
                : "bg-[var(--lr-raised)] text-[var(--lr-ink-2)]"
            }`}
          >
            {match.classification === "compatible" ? (
              <CheckCircle2 aria-hidden="true" className="size-5" />
            ) : (
              <Sparkles aria-hidden="true" className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--lr-accent)]">
              {classificationLabel[match.classification]}
            </p>
            <Link href={counterpartHref} className="mt-1 block font-semibold leading-snug text-[var(--lr-ink)] hover:text-[var(--lr-accent)]">
              {counterpartTitle}
            </Link>
          </div>
        </div>
        {/* Il punteggio serve a mettere in fila, non a decidere: sta in
          * piccolo, e la parola che conta è già scritta sopra. */}
        <div className="shrink-0 text-right">
          <p className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            {Math.round(match.score)} su 100
          </p>
        </div>
      </div>

      <div className="grid gap-4 border-t border-[var(--lr-line-quiet)] px-5 py-4 sm:grid-cols-[1.15fr_.85fr]">
        <CriteriaList
          icon={CheckCircle2}
          label="Punti a favore"
          items={positive}
          positive
        />
        <CriteriaList
          icon={conflicts.length ? AlertTriangle : CircleDot}
          label={conflicts.length ? "Da controllare" : "Nessun ostacolo"}
          items={conflicts}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="line-clamp-2 text-xs leading-5 text-[var(--lr-ink-2)]">
          {match.explanation ||
            "Il confronto è stato calcolato sui dati disponibili."}
        </p>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          {detailHref ? (
            <Link href={detailHref} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[7px] border border-[var(--lr-line)] px-3 text-xs font-bold text-[var(--lr-ink)] hover:border-[var(--lr-accent)] hover:text-[var(--lr-accent)]">
              Analizza <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CriteriaList({
  icon: Icon,
  label,
  items,
  positive = false,
}: Readonly<{
  icon: typeof CheckCircle2;
  label: string;
  items: string[];
  positive?: boolean;
}>) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-bold text-[var(--lr-ink-2)]">
        <Icon
          aria-hidden="true"
          className={`size-3.5 ${
            positive
              ? "text-[var(--lr-accent)]"
              : "text-[var(--lr-warn)]"
          }`}
        />
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.slice(0, 4).map((item) => (
          <span
            key={item}
            className="rounded-full border border-[var(--lr-line)] bg-[var(--lr-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--lr-ink-2)]"
          >
            {item}
          </span>
        ))}
        {!items.length ? (
          <span className="text-xs text-[var(--lr-ink-3)]">
            {positive ? "Nessun dato sufficiente" : "Tutto in ordine"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

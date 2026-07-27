import Link from "next/link";
import type { MatchClassification, MatchStatus } from "@/lib/matching/types";
import { MatchStatusSelect } from "./management-panels";

const classificationLabel: Record<MatchClassification, string> = {
  compatible: "Compatibile", almost_compatible: "Quasi compatibile",
  weak: "Debole", not_relevant: "Poco pertinente",
};

export function MatchCard({
  match, counterpartHref, counterpartTitle,
}: Readonly<{
  match: {
    id: string; score: number; classification: MatchClassification; status: MatchStatus;
    matched_criteria?: string[]; missing_preferences?: string[];
    conflicting_criteria?: string[]; explanation?: string;
  };
  counterpartHref: string;
  counterpartTitle: string;
}>) {
  return <article className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">{classificationLabel[match.classification]}</p><Link href={counterpartHref} className="mt-1 block font-semibold text-[var(--ink-strong)] hover:underline">{counterpartTitle}</Link></div>
      <div className="rounded-[8px] bg-[var(--surface-muted)] px-3 py-2 text-right"><strong className="text-xl text-[var(--ink-strong)]">{Math.round(match.score)}%</strong><p className="text-[10px] uppercase text-[var(--ink-subtle)]">compatibilità</p></div>
    </div>
    {match.explanation ? <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{match.explanation}</p> : null}
    <div className="mt-4 max-w-52"><MatchStatusSelect id={match.id} value={match.status} /></div>
  </article>;
}


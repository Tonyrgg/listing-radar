"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type ScoreFactor = {
  id: string;
  label: string;
  explanation: string;
  points: number;
};

type ScoreTone = "red" | "amber" | "green";

const pillToneClasses: Record<ScoreTone, string> = {
  red: "border-[oklch(0.48_0.12_26)] bg-[oklch(0.27_0.06_26)] text-[oklch(0.78_0.15_26)]",
  amber:
    "border-[oklch(0.52_0.1_82)] bg-[oklch(0.3_0.055_82)] text-[var(--status-warning)]",
  green:
    "border-[color-mix(in_oklch,var(--surface-accent)_35%,transparent)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
};

function getScoreTone(progress: number): ScoreTone {
  if (progress <= 33) return "red";
  if (progress <= 66) return "amber";
  return "green";
}

function FactorRow({ factor }: Readonly<{ factor: ScoreFactor }>) {
  const isPositive = factor.points > 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">
          {factor.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-subtle)]">
          {factor.explanation}
        </p>
      </div>
      <strong
        className={
          isPositive
            ? "text-sm tabular-nums text-[var(--surface-accent)]"
            : "text-sm tabular-nums text-[var(--status-error)]"
        }
      >
        {isPositive ? `+${factor.points}` : factor.points}
      </strong>
    </div>
  );
}

export function ListingScorePopover({
  total,
  level,
  progress,
  awarded,
  deductions,
}: Readonly<{
  total: number;
  level: string;
  progress: number;
  awarded: ScoreFactor[];
  deductions: ScoreFactor[];
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const tone = getScoreTone(progress);
  const activeFactors = [...awarded, ...deductions];

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full cursor-pointer rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-muted)_82%,var(--surface-accent-soft))] p-3 text-left transition-colors hover:border-[var(--line-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        aria-haspopup="dialog"
      >
        <span className="block text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
          Appetibilita
        </span>
        <span className="mt-2 flex items-end justify-center gap-2">
          <strong className="text-[32px] font-semibold leading-none tabular-nums text-[var(--ink-strong)]">
            {total}
          </strong>
          <span className="pb-1 text-xs font-semibold text-[var(--ink-soft)]">
            pt
          </span>
          <span
            className={`mb-1 rounded-full border px-2 py-1 text-[10px] font-bold leading-none ${pillToneClasses[tone]}`}
          >
            {level}
          </span>
        </span>
        <span className="relative mt-3 block h-2 overflow-hidden rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.17_26)_0%,oklch(0.62_0.17_26)_33%,oklch(0.78_0.14_82)_33%,oklch(0.78_0.14_82)_66%,var(--surface-accent)_66%,var(--surface-accent)_100%)]">
          <span
            className="absolute top-0 block h-full w-1 rounded-full bg-[var(--ink-strong)] shadow-[0_0_0_1px_var(--surface-canvas)]"
            style={{ left: `calc(${progress}% - 2px)` }}
          />
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] grid place-items-center bg-[oklch(0.08_0.02_154/0.72)] px-4 py-6"
              role="presentation"
              onMouseDown={() => setIsOpen(false)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="max-h-[min(720px,90vh)] w-full max-w-md overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="border-b border-[var(--line-soft)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
                        Appetibilita
                      </p>
                      <h2
                        id={titleId}
                        className="mt-2 text-xl font-semibold text-[var(--ink-strong)]"
                      >
                        {total} pt
                        <span
                          className={`ml-2 align-middle rounded-full border px-2 py-1 text-[10px] font-bold ${pillToneClasses[tone]}`}
                        >
                          {level}
                        </span>
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="rounded-md border border-[var(--line-strong)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-muted)]"
                    >
                      Chiudi
                    </button>
                  </div>
                  <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.17_26)_0%,oklch(0.62_0.17_26)_33%,oklch(0.78_0.14_82)_33%,oklch(0.78_0.14_82)_66%,var(--surface-accent)_66%,var(--surface-accent)_100%)]">
                    <span
                      className="absolute top-0 block h-full w-1 rounded-full bg-[var(--ink-strong)] shadow-[0_0_0_1px_var(--surface-canvas)]"
                      style={{ left: `calc(${progress}% - 2px)` }}
                    />
                  </div>
                </div>

                <div className="max-h-[52vh] overflow-y-auto p-5">
                  {activeFactors.length ? (
                    activeFactors.map((factor) => (
                      <FactorRow key={factor.id} factor={factor} />
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-[var(--ink-soft)]">
                      Nessuna voce ha ancora contribuito al punteggio.
                    </p>
                  )}
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

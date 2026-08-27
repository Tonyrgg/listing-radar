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
  red: "border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] text-[var(--lr-danger)]",
  amber: "border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] text-[var(--lr-warn)]",
  green: "border-[var(--lr-ok)] bg-[var(--lr-ok-soft)] text-[var(--lr-ok)]",
};

function getScoreTone(progress: number): ScoreTone {
  if (progress <= 33) return "red";
  if (progress <= 66) return "amber";
  return "green";
}

function FactorRow({ factor }: Readonly<{ factor: ScoreFactor }>) {
  const isPositive = factor.points > 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-[var(--lr-line-quiet)] py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">
          {factor.label}
        </p>
        <p className="mt-1 text-[length:var(--lr-text-meta)] leading-5 text-[var(--lr-ink-3)]">
          {factor.explanation}
        </p>
      </div>
      <strong
        className={
          isPositive
            ? "text-[length:var(--lr-text-body)] tabular-nums text-[var(--lr-accent)]"
            : "text-[length:var(--lr-text-body)] tabular-nums text-[var(--lr-danger)]"
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
  notAwardedCount = 0,
  awarded,
  deductions,
}: Readonly<{
  total: number;
  level: string;
  progress: number;
  /** Quanti criteri non sono maturati: serve a scrivere «3 indizi su 4». */
  notAwardedCount?: number;
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
        className="w-full cursor-pointer rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-3 py-2 text-left transition-colors hover:bg-[var(--lr-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]"
        aria-haspopup="dialog"
        title="Perché conviene guardarla: apri per vedere i criteri"
      >
        {/* Mai un numero da 0 a 100: «72» richiede di sapere cosa vuol dire 72.
          * Una parola e gli indizi che la sostengono si leggono in un istante. */}
        <span className="block text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          Conviene
        </span>
        <span className="mt-0.5 block text-[length:var(--lr-text-record)] font-[650] leading-none text-[var(--lr-ink)]">
          {level}
        </span>
        <span className="mt-1 block text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
          {awarded.length} {awarded.length === 1 ? "indizio" : "indizi"} su{" "}
          {awarded.length + notAwardedCount}
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] grid place-items-center bg-[rgb(0_0_0/0.6)] px-4 py-6"
              role="presentation"
              onMouseDown={() => setIsOpen(false)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="max-h-[min(720px,90vh)] w-full max-w-md overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="border-b border-[var(--lr-line-quiet)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[length:var(--lr-text-meta)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
                        Appetibilità
                      </p>
                      <h2
                        id={titleId}
                        className="mt-2 text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]"
                      >
                        {total} pt
                        <span
                          className={`ml-2 align-middle rounded-full border px-2 py-1 text-[length:var(--lr-text-label)] font-bold ${pillToneClasses[tone]}`}
                        >
                          {level}
                        </span>
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="rounded-md border border-[var(--lr-line)] px-3 py-2 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)] transition-colors hover:bg-[var(--lr-raised)]"
                    >
                      Chiudi
                    </button>
                  </div>
                  <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-[linear-gradient(90deg,var(--lr-danger)_0%,var(--lr-danger)_33%,var(--lr-warn)_33%,var(--lr-warn)_66%,var(--lr-accent)_66%,var(--lr-accent)_100%)]">
                    <span
                      className="absolute top-0 block h-full w-1 rounded-full bg-[var(--lr-ink)] shadow-[0_0_0_1px_var(--lr-canvas)]"
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
                    <p className="text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink-2)]">
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

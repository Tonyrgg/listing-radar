"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import type { ListingCompletenessField } from "@/lib/listings/completeness";

const severityLabels: Record<ListingCompletenessField["severity"], string> = {
  required: "Necessario",
  recommended: "Consigliato",
};

const severityToneClasses: Record<ListingCompletenessField["severity"], string> = {
  required:
    "border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] text-[var(--lr-danger)]",
  recommended:
    "border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] text-[var(--lr-warn)]",
};

function MissingFieldRow({
  field,
}: Readonly<{ field: ListingCompletenessField }>) {
  return (
    <div className="border-t border-[var(--lr-line-quiet)] py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--lr-ink)]">
          {field.label}
        </p>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold leading-none ${severityToneClasses[field.severity]}`}
        >
          {severityLabels[field.severity]}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--lr-ink-3)]">
        {field.reason}
      </p>
    </div>
  );
}

export function ListingCompletenessPopover({
  score,
  fields,
  triggerLabel,
}: Readonly<{
  score: number;
  fields: ListingCompletenessField[];
  triggerLabel: string;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

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
        className="inline-flex min-h-6 max-w-full cursor-pointer items-center rounded-md text-xs font-semibold text-[var(--lr-warn)] underline-offset-4 transition-colors hover:text-[var(--lr-warn)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]"
        aria-haspopup="dialog"
      >
        <span className="truncate">{triggerLabel}</span>
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
                className="max-h-[min(720px,90vh)] w-full max-w-md overflow-hidden rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="border-b border-[var(--lr-line-quiet)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--lr-ink-3)]">
                        Completezza
                      </p>
                      <h2
                        id={titleId}
                        className="mt-2 text-xl font-semibold text-[var(--lr-ink)]"
                      >
                        {score}%
                        <span className="ml-2 align-middle rounded-full border border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] px-2 py-1 text-[10px] font-bold text-[var(--lr-warn)]">
                          {triggerLabel}
                        </span>
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="rounded-md border border-[var(--lr-line)] px-3 py-2 text-xs font-semibold text-[var(--lr-ink-2)] transition-colors hover:bg-[var(--lr-raised)]"
                    >
                      Chiudi
                    </button>
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--lr-canvas)]">
                    <div
                      className="h-full rounded-full bg-[var(--lr-warn)]"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>

                <div className="max-h-[52vh] overflow-y-auto p-5">
                  {fields.length ? (
                    fields.map((field) => (
                      <MissingFieldRow key={field.key} field={field} />
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-[var(--lr-ink-2)]">
                      Nessun campo da rivedere.
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

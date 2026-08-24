"use client";

import { Children, type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

export function ProgressiveList({
  children,
  className,
  initialCount = 6,
  step = 6,
  noun = "risultati",
}: Readonly<{
  children: ReactNode;
  className?: string;
  initialCount?: number;
  step?: number;
  noun?: string;
}>) {
  const items = Children.toArray(children);
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const visible = items.slice(0, visibleCount);
  const remaining = Math.max(0, items.length - visibleCount);

  return (
    <>
      <div className={className}>{visible}</div>
      {remaining ? (
        <div className="mt-5 flex justify-center border-t border-[var(--lr-line-quiet)] pt-5">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(items.length, current + step))}
            className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-[var(--lr-line)] bg-[var(--lr-surface)] px-5 text-sm font-bold text-[var(--lr-ink)] hover:border-[var(--lr-accent)] hover:text-[var(--lr-accent)]"
          >
            Mostra altri {Math.min(step, remaining)} {noun}
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </>
  );
}

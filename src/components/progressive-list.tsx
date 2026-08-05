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
        <div className="mt-5 flex justify-center border-t border-[var(--line-soft)] pt-5">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(items.length, current + step))}
            className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-[var(--line-strong)] bg-[var(--surface-panel)] px-5 text-sm font-bold text-[var(--ink-strong)] hover:border-[var(--surface-accent)] hover:text-[var(--surface-accent)]"
          >
            Mostra altri {Math.min(step, remaining)} {noun}
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </>
  );
}

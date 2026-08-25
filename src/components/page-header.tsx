import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * L'unica intestazione di pagina del prodotto.
 * Sostituisce PageHeader, MatchingSectionHeader e LifecycleHeader.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel,
  nav,
}: Readonly<{
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Navigazione di sezione, quando la sezione ne ha una. */
  nav?: ReactNode;
}>) {
  return (
    <header className="border-b border-[var(--lr-line-quiet)] pb-6">
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className="mb-4 inline-flex min-h-[var(--lr-control-height-compact)] items-center gap-2 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink-2)] transition-colors hover:text-[var(--lr-ink)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
            {eyebrow}
          </p>
          <h1 className="font-display mt-2 text-[length:var(--lr-text-page)] leading-tight text-balance text-[var(--lr-ink)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>

      {nav ? <div className="mt-4">{nav}</div> : null}
    </header>
  );
}

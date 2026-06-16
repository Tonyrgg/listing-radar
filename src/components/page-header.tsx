import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel,
}: Readonly<{
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}>) {
  return (
    <header className="rounded-[7px] border border-[var(--line-soft)] bg-[linear-gradient(180deg,var(--surface-panel),oklch(0.225_0.019_154))] px-5 py-5 shadow-[var(--shadow-panel)]">
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink-strong)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--surface-accent)]">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-[var(--ink-strong)] lg:text-[32px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

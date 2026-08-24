import { clsx } from "clsx";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/* ---------------------------------------------------------------------------
 * Un componente per ogni lavoro, e uno solo.
 * Chi ha bisogno di una card, di un chip o di un bottone parte da qui.
 * ------------------------------------------------------------------------- */

export type Tone = "neutral" | "action" | "warn" | "danger" | "info";

const chipTone: Record<Tone, string> = {
  neutral: "border-[var(--lr-line)] text-[var(--lr-ink-2)]",
  action: "border-[var(--lr-accent)] bg-[var(--lr-accent-soft)] text-[var(--lr-accent)]",
  warn: "border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] text-[var(--lr-warn)]",
  danger: "border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] text-[var(--lr-danger)]",
  info: "border-[var(--lr-info)] bg-[var(--lr-info-soft)] text-[var(--lr-info)]",
};

const stripeTone: Record<Tone, string> = {
  neutral: "bg-[var(--lr-line-quiet)]",
  action: "bg-[var(--lr-accent)]",
  warn: "bg-[var(--lr-warn)]",
  danger: "bg-[var(--lr-danger)]",
  info: "bg-[var(--lr-info)]",
};

/**
 * Il chip comunica stato o categoria. Non sostituisce mai un bottone.
 * Oltre al colore porta sempre una forma: il pallino, o un'icona passata da fuori.
 */
export function Chip({
  children,
  tone = "neutral",
  dot = false,
  className,
}: Readonly<{
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-[length:var(--lr-text-label)] font-medium leading-5 tracking-[0.03em] whitespace-nowrap",
        chipTone[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

/** La banda laterale dice l'urgenza senza consumare l'accento. */
export function Stripe({ tone = "neutral" }: Readonly<{ tone?: Tone }>) {
  return (
    <span
      aria-hidden="true"
      className={clsx("w-[3px] shrink-0 self-stretch rounded-full", stripeTone[tone])}
    />
  );
}

/**
 * Il contenitore. Un solo raggio, un solo bordo, due livelli di elevazione.
 * `floating` è riservato a mappa, drawer e finestre di dialogo.
 */
export function Card({
  children,
  className,
  floating = false,
  as: Tag = "section",
}: Readonly<{
  children: ReactNode;
  className?: string;
  floating?: boolean;
  as?: "section" | "article" | "div" | "aside";
}>) {
  return (
    <Tag
      className={clsx(
        "rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)]",
        floating && "shadow-[var(--lr-floating)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  meta,
  action,
  className,
}: Readonly<{
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={clsx(
        "flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2",
        "border-b border-[var(--lr-line-quiet)] px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[length:var(--lr-text-record)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
          {title}
        </h2>
        {meta ? <p className="mt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">{meta}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={clsx("p-4", className)}>{children}</div>;
}

/** Occhiello: 11 px, maiuscoletto, tracking positivo. Mai colorato d'accento. */
export function Label({
  children,
  className,
  tone,
}: Readonly<{ children: ReactNode; className?: string; tone?: Tone }>) {
  return (
    <p
      className={clsx(
        "text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)]",
        tone === "action"
          ? "text-[var(--lr-accent)]"
          : tone === "warn"
            ? "text-[var(--lr-warn)]"
            : tone === "danger"
              ? "text-[var(--lr-danger)]"
              : "text-[var(--lr-ink-3)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Meta({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <p className={clsx("text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]", className)}>
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * Bottoni. Un solo `primary` per regione di schermo: è la regola dell'accento.
 * ------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const buttonVariant: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--lr-accent)] text-[var(--lr-accent-ink)] hover:bg-[var(--lr-accent-hover)]",
  secondary:
    "border-[var(--lr-line)] text-[var(--lr-ink)] hover:bg-[var(--lr-raised)]",
  quiet:
    "border-transparent text-[var(--lr-ink-2)] hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
  danger:
    "border-[var(--lr-danger)] text-[var(--lr-danger)] hover:bg-[var(--lr-danger-soft)]",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  options: { compact?: boolean; block?: boolean; icon?: boolean } = {},
) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border",
    "text-[length:var(--lr-text-body)] font-medium whitespace-nowrap",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    options.compact
      ? "min-h-[var(--lr-control-height-compact)]"
      : "min-h-[var(--lr-control-height)]",
    options.icon ? "aspect-square px-0" : "px-4",
    options.block && "w-full",
    buttonVariant[variant],
  );
}

export function Button({
  children,
  variant = "secondary",
  compact,
  block,
  icon,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  compact?: boolean;
  block?: boolean;
  icon?: boolean;
}) {
  return (
    <button {...props} className={clsx(buttonClass(variant, { compact, block, icon }), className)}>
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  href,
  variant = "secondary",
  compact,
  block,
  icon,
  className,
  external = false,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  href: string;
  variant?: ButtonVariant;
  compact?: boolean;
  block?: boolean;
  icon?: boolean;
  /** Solo i link fuori dal prodotto lasciano l'applicazione. */
  external?: boolean;
}) {
  const classes = clsx(buttonClass(variant, { compact, block, icon }), className);

  if (external) {
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link {...props} href={href} className={classes}>
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------------------
 * Stato vuoto: dice cosa è successo e cosa succede dopo.
 * Non simula mai contenuto in caricamento.
 * ------------------------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  action,
  className,
}: Readonly<{
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={clsx("px-4 py-10 text-center", className)}>
      <p className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)]">{title}</p>
      <p className="mx-auto mt-2 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
        {description}
      </p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

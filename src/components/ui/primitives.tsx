import { clsx } from "clsx";
import { ArrowRight, LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/* ---------------------------------------------------------------------------
 * Un componente per ogni lavoro, e uno solo.
 * Chi ha bisogno di una card, di un chip o di un bottone parte da qui.
 * ------------------------------------------------------------------------- */

/**
 * `action` è il rame, e vuol dire «questo è il passo successivo».
 * Gli altri dicono come stanno le cose: `ok` è la conferma che prima veniva
 * scritta in rame — ed è per questo che l'accento finiva su ogni pillola.
 */
export type Tone = "neutral" | "action" | "ok" | "warn" | "danger" | "info";

const chipTone: Record<Tone, string> = {
  neutral: "border-[var(--lr-line)] text-[var(--lr-ink-2)]",
  action: "border-[var(--lr-accent)] bg-[var(--lr-accent-soft)] text-[var(--lr-accent)]",
  ok: "border-[var(--lr-ok)] bg-[var(--lr-ok-soft)] text-[var(--lr-ok)]",
  warn: "border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] text-[var(--lr-warn)]",
  danger: "border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] text-[var(--lr-danger)]",
  info: "border-[var(--lr-info)] bg-[var(--lr-info-soft)] text-[var(--lr-info)]",
};

const stripeTone: Record<Tone, string> = {
  neutral: "bg-[var(--lr-line-quiet)]",
  action: "bg-[var(--lr-accent)]",
  ok: "bg-[var(--lr-ok)]",
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

/** Un punto compatto segnala lo stato senza creare una falsa colonna visiva. */
export function Stripe({ tone = "neutral" }: Readonly<{ tone?: Tone }>) {
  return (
    <span
      aria-hidden="true"
      className={clsx("size-2 shrink-0 self-center rounded-full", stripeTone[tone])}
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
  children?: ReactNode;
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

/** Il collegamento copre davvero tutta la riga, compresa la coda a destra. */
export function RowLink({
  href,
  label,
}: Readonly<{ href: string; label: string }>) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="absolute inset-0 z-20 rounded-[var(--lr-radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--lr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lr-surface)]"
    />
  );
}

/** Il segnale visivo dell'azione di riga: leggibile e con un bersaglio da 44 px. */
export function RowAction({ label = "Apri" }: Readonly<{ label?: string }>) {
  return (
    <span className="inline-flex size-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-surface)] text-[length:var(--lr-text-label)] font-semibold text-[var(--lr-ink-2)] transition-colors group-hover:border-[var(--lr-ink-3)] group-hover:bg-[var(--lr-raised)] group-hover:text-[var(--lr-ink)] sm:w-auto sm:px-3">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <ArrowRight aria-hidden="true" className="size-4" />
    </span>
  );
}

/** Una cornice per i filtri: prima il risultato, poi i campi. */
export function FilterBar({
  children,
  summary,
  active = false,
  resetHref,
  className,
}: Readonly<{
  children: ReactNode;
  summary: ReactNode;
  active?: boolean;
  resetHref?: string;
  className?: string;
}>) {
  return (
    <section
      className={clsx(
        "rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-3 sm:p-4",
        className,
      )}
      aria-label="Filtri dell'elenco"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--lr-raised)] text-[var(--lr-ink-3)]">
            <Search aria-hidden="true" className="size-3.5" />
          </span>
          <p className="text-[length:var(--lr-text-meta)] font-[650] text-[var(--lr-ink)]">{summary}</p>
        </div>
        {active && resetHref ? (
          <Link href={resetHref} className={buttonClass("quiet", { compact: true })}>
            <X aria-hidden="true" className="size-4" />
            Azzera filtri
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
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
 * L'attesa.
 *
 * Uno scheletro che non somiglia alla pagina è una bugia breve: la pagina
 * salta quando i dati arrivano. Questi pezzi ricalcano le forme vere —
 * l'intestazione, la barra dei filtri, la riga con la foto.
 * ------------------------------------------------------------------------- */

export function Scheletro({ className }: Readonly<{ className?: string }>) {
  return <div className={clsx("animate-pulse rounded bg-[var(--lr-raised)]", className)} />;
}

export function ScheletroIntestazione() {
  return (
    <div className="border-b border-[var(--lr-line-quiet)] pb-5">
      <Scheletro className="h-3 w-20" />
      <Scheletro className="mt-2 h-7 w-64" />
      <Scheletro className="mt-2 h-4 w-80 max-w-full" />
    </div>
  );
}

/** La barra dei filtri: controlli alti quanto quelli veri. */
export function ScheletroFiltri({ quanti = 3 }: Readonly<{ quanti?: number }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <Scheletro className="h-[var(--lr-control-height)] min-w-56 flex-1 rounded-[var(--lr-radius-control)]" />
      {Array.from({ length: quanti }).map((_, indice) => (
        <Scheletro
          key={indice}
          className="h-[var(--lr-control-height)] w-40 rounded-[var(--lr-radius-control)]"
        />
      ))}
    </div>
  );
}

/** Una riga di casa: la foto e le tre righe di testo, nelle stesse misure. */
export function ScheletroRiga() {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0">
      <Scheletro className="h-24 w-32 shrink-0 rounded-[var(--lr-radius-control)] sm:h-28 sm:w-40" />
      <div className="min-w-0 flex-1 space-y-2">
        <Scheletro className="h-3 w-32" />
        <Scheletro className="h-4 w-64 max-w-full" />
        <Scheletro className="h-4 w-48 max-w-full" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * I controlli dei moduli.
 *
 * Erano tre implementazioni della stessa cosa: le classi di
 * `lifecycle.module.css` (44 px, fondo rialzato, testo 0,78rem), quelle di
 * `section-design.module.css`, e sedici copie scritte a mano dentro le barre
 * dei filtri. Tre altezze, tre fondi, tre misure di testo per un campo di
 * testo.
 *
 * Adesso il campo ha un aspetto solo: fondo della pagina dentro una linea, la
 * stessa altezza dei bottoni. Su una scheda si legge come un incavo, sulla
 * pagina come una casella — ed è sempre la stessa cosa.
 * ------------------------------------------------------------------------- */

export function controlClass(className?: string, options: { conIcona?: boolean } = {}) {
  return clsx(
    "min-h-[var(--lr-control-height)] w-full rounded-[var(--lr-radius-control)]",
    "border border-[var(--lr-line)] bg-[var(--lr-canvas)]",
    /* La lente occupa il posto del margine sinistro: le due spaziature non
     * possono convivere nello stesso attributo. */
    options.conIcona ? "pl-9 pr-3" : "px-3",
    "text-[length:var(--lr-text-body)] text-[var(--lr-ink)]",
    "outline-none transition-colors placeholder:text-[var(--lr-ink-3)]",
    "focus-visible:border-[var(--lr-accent)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
}

/** La casella di ricerca, con la sua lente. Quattro pagine la ridisegnavano. */
export function Ricerca({
  label,
  placeholder,
  name = "q",
  defaultValue,
  className,
}: Readonly<{
  label: string;
  placeholder?: string;
  name?: string;
  defaultValue?: string;
  className?: string;
}>) {
  return (
    <label className={clsx("relative min-w-56 flex-1", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lr-ink-3)]"
      />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={controlClass(undefined, { conIcona: true })}
      />
    </label>
  );
}

/** Un campo con la sua etichetta. Senza etichetta visibile, resta per chi legge con lo schermo. */
export function Campo({
  label,
  hint,
  children,
  labelHidden = false,
  className,
}: Readonly<{
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Nelle barre dei filtri l'etichetta la dicono già le opzioni. */
  labelHidden?: boolean;
  className?: string;
}>) {
  return (
    <label className={clsx("grid gap-1.5", className)}>
      <span
        className={clsx(
          labelHidden
            ? "sr-only"
            : "text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-ink-2)]",
        )}
      >
        {label}
      </span>
      {children}
      {hint && !labelHidden ? <Meta>{hint}</Meta> : null}
    </label>
  );
}

export function Testo({
  className,
  ...props
}: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return <input {...props} className={controlClass(className)} />;
}

export function Scelta({
  className,
  children,
  ...props
}: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <select {...props} className={controlClass(className)}>
      {children}
    </select>
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
  loading = false,
  loadingLabel = "Operazione in corso",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  compact?: boolean;
  block?: boolean;
  icon?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(buttonClass(variant, { compact, block, icon }), className, loading && "cursor-wait")}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      {loading ? loadingLabel : children}
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

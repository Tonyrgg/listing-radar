import { DatabaseZap, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatCurrency, formatNumber, formatShouty } from "@/lib/formatting";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";
import { propertyStateLabel } from "@/lib/property-lifecycle/read-models/presentation";

import { LifecycleSectionNav } from "@/components/lifecycle-section-nav";
import { PageHeader } from "@/components/page-header";
import { Chip } from "@/components/ui/primitives";

import styles from "../lifecycle.module.css";

export function LifecycleHeader({
  eyebrow,
  title,
  description,
  actions,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}>) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      nav={<LifecycleSectionNav />}
    />
  );
}

export function LifecycleSection({
  title,
  description,
  action,
  children,
}: Readonly<{
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function LifecycleEmpty({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <div className={styles.empty}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function LifecycleUnavailable({ message }: Readonly<{ message: string | null }>) {
  return (
    <div className={styles.workspace}>
      <LifecycleHeader
        eyebrow="Segnali"
        title="I segnali non sono ancora disponibili"
        description="Questa sezione lavora su un archivio separato che non risulta ancora pronto. Il resto del programma funziona normalmente."
      />
      <div className={styles.unavailable}>
        <div>
          <DatabaseZap aria-hidden="true" className="mx-auto size-6 text-[var(--lr-warn)]" />
          <strong className="mt-4 block">Archivio dei segnali non raggiungibile</strong>
          <p>{message ?? "Riprova tra poco. Se il problema resta, l'archivio va allineato dalle impostazioni prima di poter usare questa sezione."}</p>
        </div>
      </div>
    </div>
  );
}

const pillTone = {
  default: "neutral",
  hot: "warn",
  high: "warn",
  good: "action",
  cool: "info",
} as const;

export function SignalPill({
  children,
  tone = "default",
}: Readonly<{
  children: ReactNode;
  tone?: keyof typeof pillTone;
}>) {
  return (
    <Chip tone={pillTone[tone]} dot>
      {children}
    </Chip>
  );
}

export function PropertyFacts({
  property,
}: Readonly<{ property: LifecyclePropertySummary }>) {
  return (
    <div className={styles.propertyFacts}>
      <strong>{formatCurrency(property.currentPrice)}</strong>
      <span>{property.surfaceSqm ? `${formatNumber(property.surfaceSqm)} m²` : "Metratura ignota"}</span>
      <span>{property.rooms ? `${formatNumber(property.rooms)} locali` : "Locali ignoti"}</span>
      <span>{propertyStateLabel(property.propertyState)}</span>
    </div>
  );
}

export function PropertyLink({ property }: Readonly<{ property: LifecyclePropertySummary }>) {
  return (
    <Link href={`/casa/${property.id}`} className={styles.signalProperty}>
      {formatShouty(property.title)}
    </Link>
  );
}

export function ExternalSourceLink({ href }: Readonly<{ href: string }>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={styles.textAction}
    >
      Fonte
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * I numeri e le date si scrivono in un posto solo.
 *
 * Qui vivevano copie di `formatCurrency` e `formatDate`: la copia non aveva il
 * raggruppamento delle migliaia, quindi la stessa casa costava «7.000 €» in
 * archivio e «7000 €» nella sua scheda. Due formattatori sono un bug che
 * aspetta il suo momento.
 */
export { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/formatting";

/** Da quanti giorni dura una cosa iniziata in quella data. */
export function ageDays(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const inizio = new Date(value).getTime();
  if (Number.isNaN(inizio)) return null;
  return Math.max(0, Math.floor((now - inizio) / (24 * 60 * 60 * 1_000)));
}

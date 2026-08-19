import { clsx } from "clsx";
import { DatabaseZap, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";
import { propertyStateLabel } from "@/lib/property-lifecycle/read-models/presentation";

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
    <header className={styles.masthead}>
      <div className={styles.mastheadRow}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lead}>{description}</p>
        </div>
        {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      </div>
    </header>
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
        eyebrow="Property Lifecycle V2"
        title="Il modello locale non è disponibile"
        description="La superficie resta isolata dal CRM storico finché le migrazioni V2 non sono presenti nel database configurato."
      />
      <div className={styles.unavailable}>
        <div>
          <DatabaseZap aria-hidden="true" className="mx-auto size-6 text-[var(--status-warning)]" />
          <strong className="mt-4 block">Dati Lifecycle non caricati</strong>
          <p>{message ?? "Verifica la connessione e applica le migrazioni additive V2."}</p>
        </div>
      </div>
    </div>
  );
}

export function SignalPill({
  children,
  tone = "default",
}: Readonly<{
  children: ReactNode;
  tone?: "default" | "hot" | "high" | "good" | "cool";
}>) {
  return (
    <span
      className={clsx(
        styles.pill,
        tone === "hot" && styles.pillHot,
        tone === "high" && styles.pillHigh,
        tone === "good" && styles.pillGood,
        tone === "cool" && styles.pillCool,
      )}
    >
      {children}
    </span>
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
    <Link href={`/lifecycle/archive/${property.id}`} className={styles.signalProperty}>
      {property.title}
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

export function formatCurrency(value: number | null): string {
  return value == null
    ? "Prezzo non disponibile"
    : new Intl.NumberFormat("it-IT", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "Data ignota";
}

export function formatDateTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Mai";
}

export function ageDays(value: string | null): number | null {
  if (!value) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1_000)),
  );
}

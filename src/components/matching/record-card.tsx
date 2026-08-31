import { ArrowUpDown, Banknote, Building2, Layers3, MapPin, Ruler, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PropertyTypeMark } from "@/components/matching/visual-language";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { requestRequiresElevator } from "@/lib/matching/elevator";

/**
 * La grammatica delle schede.
 *
 * Il quadro «chi cerca cosa» aveva trovato la forma giusta — chi è, cosa
 * vuole in pastiglie, quante case ci sono, una porta per andarci — ma quella
 * forma viveva dentro una sola pagina. Le richieste dicevano le stesse cose in
 * prosa e il portafoglio non le diceva affatto: tre sezioni dello stesso
 * prodotto con tre modi di presentarsi.
 *
 * Qui la forma diventa un vocabolario solo. Chi la usa non ridisegna: compone.
 */

/** Un dato che si legge di sfuggita: icona, valore, l'etichetta al lettore di schermo. */
export function FactPill({
  icon: Icon,
  label,
  children,
}: Readonly<{ icon: LucideIcon; label: string; children: ReactNode }>) {
  return (
    <span
      title={label}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-2.5 text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-ink-2)]"
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-[var(--lr-ink-3)]" />
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}

/** Quel tanto di una richiesta che serve per capirla senza aprirla. */
type RequestLike = Readonly<{
  contract_type: string;
  property_types?: readonly string[] | null;
  budget_ideal?: number | null;
  budget_max?: number | null;
  monthly_rent_ideal?: number | null;
  monthly_rent_max?: number | null;
  internal_sqm_min?: number | null;
  internal_sqm_ideal?: number | null;
  rooms_min?: number | null;
  rooms_ideal?: number | null;
  municipality?: string | null;
  request_zones?:
    | readonly Readonly<{
        preference_level: string;
        zone?: Readonly<{ name?: string | null }> | null;
      }>[]
    | null;
  request_feature_preferences?:
    | readonly Readonly<{
        preference_level: string;
        feature?: Readonly<{ key?: string | null }> | null;
      }>[]
    | null;
}>;

export function requestZoneNames(request: RequestLike) {
  return [
    ...new Set(
      (request.request_zones ?? [])
        .filter((item) => item.preference_level !== "excluded")
        .map((item) => item.zone?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

/**
 * Cosa cerca il cliente, in pastiglie.
 *
 * `subtype` è la sottotipologia scritta a mano nel gestionale: quando c'è vale
 * più del campo strutturato, perché è la parola che il cliente ha davvero
 * detto — «villa singola», non «villa».
 */
export function RequestFacts({
  request,
  subtype,
}: Readonly<{ request: RequestLike; subtype?: string | null }>) {
  const affitto = request.contract_type === "rent";
  const budget = affitto
    ? (request.monthly_rent_max ?? request.monthly_rent_ideal)
    : (request.budget_max ?? request.budget_ideal);
  const superficie = request.internal_sqm_ideal ?? request.internal_sqm_min;
  const locali = request.rooms_ideal ?? request.rooms_min;
  const posizione = requestZoneNames(request).join(" · ") || request.municipality;

  return (
    <>
      {subtype ? (
        <FactPill icon={Building2} label="Tipologia">
          {subtype}
        </FactPill>
      ) : (
        request.property_types?.map((type) => (
          <PropertyTypeMark key={type} type={type} />
        ))
      )}
      {budget != null ? (
        <FactPill icon={Banknote} label="Budget">
          fino a {formatCurrency(budget)}
          {affitto ? " al mese" : ""}
        </FactPill>
      ) : null}
      {superficie != null ? (
        <FactPill icon={Ruler} label="Superficie">
          {formatNumber(superficie)} mq
        </FactPill>
      ) : null}
      {locali != null ? (
        <FactPill icon={Layers3} label="Locali">
          {formatNumber(locali)} locali
        </FactPill>
      ) : null}
      {requestRequiresElevator(request) ? (
        <FactPill icon={ArrowUpDown} label="Ascensore">
          ascensore obbligatorio
        </FactPill>
      ) : null}
      {posizione ? (
        <FactPill icon={MapPin} label="Zone richieste">
          {posizione}
        </FactPill>
      ) : null}
    </>
  );
}

/**
 * L'attacco di una scheda: chi è a sinistra con le sue pastiglie, quanto pesa
 * e dove si va a destra. La riga non cresce mai: le pastiglie vanno a capo,
 * la porta resta dov'è.
 */
export function RecordCardHeader({
  icon: Icon,
  title,
  facts,
  factsLabel = "Caratteristiche",
  subtitle,
  chips,
  action,
}: Readonly<{
  icon?: LucideIcon;
  title: ReactNode;
  facts?: ReactNode;
  factsLabel?: string;
  subtitle?: ReactNode;
  chips?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--lr-line-quiet)] px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[length:var(--lr-text-record)] font-[650] leading-tight text-[var(--lr-ink)]">
          {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
          {title}
        </p>
        {facts ? (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={factsLabel}>
            {facts}
          </div>
        ) : null}
        {subtitle ? (
          <p className="mt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {chips || action ? (
        <div className="flex shrink-0 items-center gap-2">
          {chips}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/**
 * La riga in fondo: dice cosa resta fuori e porta dove si vede tutto. La
 * classe e' esposta a parte perche' certe code portano fuori dal prodotto — al
 * gestionale — e li' serve un'ancora vera, non un Link di Next.
 */
export const cardFooterLinkClass =
  "block border-t border-[var(--lr-line-quiet)] px-4 py-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]";

export function CardFooterLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link href={href} className={cardFooterLinkClass}>
      {children}
    </Link>
  );
}

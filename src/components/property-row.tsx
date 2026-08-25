import { ArrowDown, ArrowUpRight, Building2, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

import { Dato, Fonte, Giudizio, Periodo, type Livello } from "@/components/ui/atoms";
import { Meta, Stripe, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { propertyStateLabel } from "@/lib/property-lifecycle/read-models/presentation";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

/**
 * Una proprietà osservata, in una riga.
 *
 * Il soggetto è la foto: una casa si riconosce guardandola, non leggendone
 * l'indirizzo. Le parole restano solo dove nessuna forma può sostituirle —
 * prezzo, indirizzo, e la ragione per cui la riga è lì.
 */

export type PropertyRowSignals = {
  livello: Livello;
  indizi: number;
  totale: number;
  motivo: string | null;
};

function anzianitaTesto(from: string | null, now: number) {
  if (!from) return "";

  const inizio = new Date(from).getTime();
  if (Number.isNaN(inizio)) return "";

  const giorni = Math.max(0, Math.floor((now - inizio) / (24 * 60 * 60 * 1000)));
  return `da almeno ${formatNumber(giorni)} giorni`;
}

export function PropertyRow({
  property,
  foto,
  signals,
  now,
  href,
  compact = false,
}: Readonly<{
  property: LifecyclePropertySummary;
  foto?: string;
  signals?: PropertyRowSignals;
  now: number;
  href?: string;
  /** In una colonna stretta la riga larga si sbriciola: qui va in verticale. */
  compact?: boolean;
}>) {
  const daPrivato = property.activePrivateCount > 0;
  const agenzia = property.agencies[0]?.name ?? null;
  const altreAgenzie = Math.max(0, property.agencies.length - 1);
  const rilanci = property.relaunchCount;
  const destinazione = href ?? `/lifecycle/archive/${property.id}`;

  const tono: Tone = daPrivato ? "warn" : property.saleStatus === "SOLD" ? "neutral" : "info";

  /* Un giudizio che vale per tutte le righe non dice niente: in archivio quasi
   * ogni casa è «bassa». Si scrive solo quando distingue questa riga dalle altre. */
  const giudizioParla = signals != null && signals.livello !== "bassa";

  return (
    <article className="group relative flex items-stretch gap-3 border-t border-[var(--lr-line-quiet)] p-3 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]">
      <Link href={destinazione} className="absolute inset-0 z-0" aria-label={property.address ?? property.title} />
      <Stripe tone={tono} />

      {/* La foto è il soggetto, non la decorazione. */}
      <span
        className={clsx(
          "relative z-10 block shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]",
          compact ? "h-16 w-24" : "h-24 w-32 sm:h-28 sm:w-40",
        )}
      >
        {foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
            Senza foto
          </span>
        )}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        {/* Chi vende: un'icona e un nome, senza etichette in più. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          <span className="inline-flex items-center gap-1.5">
            {daPrivato ? (
              <UserRound aria-hidden="true" className="size-3.5 text-[var(--lr-warn)]" />
            ) : (
              <Building2 aria-hidden="true" className="size-3.5" />
            )}
            {daPrivato ? (
              <span className="text-[var(--lr-warn)]">Da privato</span>
            ) : agenzia ? (
              <Fonte name={agenzia} />
            ) : (
              <span>{propertyStateLabel(property.propertyState)}</span>
            )}
          </span>
          {altreAgenzie > 0 ? <span>e altre {altreAgenzie}</span> : null}
          {rilanci > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={`Ripubblicata ${rilanci} volte: l'annuncio è stato rilanciato, ma la casa è sul mercato da prima`}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {rilanci}
            </span>
          ) : null}
        </div>

        {/* Alcune fonti danno solo la zona: si scrive tratteggiato, perché
          * non è l'indirizzo della casa ma il posto dove sta. */}
        <h3 className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
          <Dato certainty={property.address ? "sure" : "guess"} hint={property.address ? undefined : "La fonte non dà l'indirizzo: è la zona"}>
            {property.address ?? property.title}
          </Dato>
        </h3>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(property.currentPrice)}</b>
          {property.surfaceSqm != null ? <span>{formatNumber(property.surfaceSqm)} mq</span> : null}
          {!compact && property.rooms != null ? (
            <span>{formatNumber(property.rooms)} locali</span>
          ) : null}
          {!compact ? (
            <Periodo
              from={anzianitaTesto(property.trueMarketStartLowerBound, now)}
              uncertain={(property.trueMarketStartConfidence ?? 0) < 0.85}
            />
          ) : null}
          {compact && giudizioParla && signals ? (
            <span className="font-[650] text-[var(--lr-ink)]">
              {signals.livello === "alta" ? "Da chiamare" : "Vale un'occhiata"}
            </span>
          ) : null}
        </div>

        {giudizioParla && signals?.motivo ? (
          <p
            className={clsx(
              "truncate text-[length:var(--lr-text-meta)]",
              signals.livello === "alta" ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink-3)]",
            )}
          >
            {signals.motivo}
          </p>
        ) : null}
      </div>

      {compact ? (
        <ArrowUpRight
          aria-hidden="true"
          className="relative z-10 size-4 shrink-0 self-center text-[var(--lr-ink-3)] transition-colors group-hover:text-[var(--lr-ink)]"
        />
      ) : (
        <div className="relative z-10 flex shrink-0 flex-col items-end justify-center gap-2">
          {giudizioParla && signals ? (
            <Giudizio
              livello={signals.livello}
              signals={signals.indizi}
              total={signals.totale}
              align="right"
            />
          ) : signals ? null : (
            <Meta>{propertyStateLabel(property.propertyState)}</Meta>
          )}
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 text-[var(--lr-ink-3)] transition-colors group-hover:text-[var(--lr-ink)]"
          />
        </div>
      )}
    </article>
  );
}

/** La freccia che accompagna un ribasso, dove serve solo il segno. */
export function SegnoRibasso() {
  return <ArrowDown aria-hidden="true" className="size-3.5 text-[var(--lr-warn)]" />;
}

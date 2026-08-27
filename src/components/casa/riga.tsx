import { ArrowUpRight, Building2, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

import {
  Dato,
  DatoAssente,
  Fonte,
  Giudizio,
  Periodo,
  livelloFromOpportunity,
  type Livello,
} from "@/components/ui/atoms";
import { Meta, Stripe, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatDays, formatNumber, formatShouty } from "@/lib/formatting";
import { cleanPropertyTitle } from "@/lib/matching/request-presentation";
import type { PortfolioProperty } from "@/lib/matching/types";
import {
  hasNoRealSignal,
  opportunityReasonLabel,
  propertyStateLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

/**
 * Una casa, in una riga — qualunque cosa sia.
 *
 * C'erano due righe diverse per la stessa cosa: una per le case osservate sul
 * mercato e una per quelle del portafoglio, con due impaginazioni e due modi
 * di scrivere «mq». Una casa è una casa: cambia chi la tiene, non la forma con
 * cui si legge.
 *
 * Il soggetto è la foto: una casa si riconosce guardandola, non leggendone
 * l'indirizzo. Le parole restano dove nessuna forma può sostituirle — prezzo,
 * indirizzo, e la ragione per cui la riga è lì.
 */

export type ChiLaTiene = "noi" | "agenzia" | "privato" | "nessuno";

export type SegnaliDellaRiga = {
  livello: Livello;
  indizi: number;
  totale: number;
  motivo: string | null;
};

export type RigaCasa = {
  id: string;
  chi: ChiLaTiene;
  indirizzo: string;
  indirizzoDedotto: boolean;
  foto?: string;
  prezzo: number | null;
  affitto: boolean;
  mq: number | null;
  locali: number | null;
  piano: number | null;
  zona: string | null;
  agenzia: string | null;
  altreAgenzie: number;
  rilanci: number;
  giorni: number | null;
  giorniIncerti: boolean;
  /** Quando l'abbiamo vista l'ultima volta: serve a mettere in fila. */
  vista: number;
  stato: string;
  segnali?: SegnaliDellaRiga;
};

const TONO: Record<ChiLaTiene, Tone> = {
  noi: "action",
  privato: "warn",
  agenzia: "info",
  nessuno: "neutral",
};

/** Una casa osservata sul mercato, letta come riga. */
export function rigaDaMercato(
  property: LifecyclePropertySummary,
  now: number,
  options: { foto?: string; opportunita?: { level: string; reasons: readonly string[] } } = {},
): RigaCasa {
  const daPrivato = property.activePrivateCount > 0;
  const agenzia = property.agencies[0]?.name ?? null;
  const inizio = property.trueMarketStartLowerBound
    ? new Date(property.trueMarketStartLowerBound).getTime()
    : Number.NaN;

  const opportunita = options.opportunita;
  const senzaSegnale = opportunita ? hasNoRealSignal(opportunita.reasons) : true;

  return {
    id: property.id,
    chi: daPrivato ? "privato" : agenzia ? "agenzia" : "nessuno",
    indirizzo: formatShouty(property.address ?? property.title),
    indirizzoDedotto: !property.address,
    foto: options.foto,
    prezzo: property.currentPrice,
    affitto: false,
    mq: property.surfaceSqm,
    locali: property.rooms,
    piano: null,
    zona: property.locality,
    agenzia,
    altreAgenzie: Math.max(0, property.agencies.length - 1),
    rilanci: property.relaunchCount,
    giorni: Number.isNaN(inizio)
      ? null
      : Math.max(0, Math.floor((now - inizio) / (24 * 60 * 60 * 1000))),
    giorniIncerti: (property.trueMarketStartConfidence ?? 0) < 0.85,
    vista: new Date(property.lastSeenAt).getTime() || 0,
    stato: propertyStateLabel(property.propertyState),
    segnali: opportunita
      ? {
          livello: livelloFromOpportunity(opportunita.level),
          indizi: senzaSegnale ? 0 : opportunita.reasons.length,
          totale: Math.max(opportunita.reasons.length, 4),
          motivo:
            senzaSegnale || !opportunita.reasons[0]
              ? null
              : opportunityReasonLabel(opportunita.reasons[0]),
        }
      : undefined,
  };
}

/** Una casa che teniamo noi, letta come riga. */
export function rigaDaPortafoglio(property: PortfolioProperty, now: number): RigaCasa {
  const inizio = property.created_at ? new Date(property.created_at).getTime() : Number.NaN;

  return {
    id: property.id,
    chi: "noi",
    indirizzo: formatShouty(property.address ?? cleanPropertyTitle(property.title)),
    indirizzoDedotto: !property.address,
    foto: property.image_urls?.[0],
    prezzo: property.contract_type === "rent" ? property.monthly_rent : property.price,
    affitto: property.contract_type === "rent",
    mq: property.internal_sqm ?? property.commercial_sqm,
    locali: property.rooms,
    piano: property.floor,
    zona: property.zone?.name ?? property.municipality,
    agenzia: null,
    altreAgenzie: 0,
    rilanci: 0,
    giorni: Number.isNaN(inizio)
      ? null
      : Math.max(0, Math.floor((now - inizio) / (24 * 60 * 60 * 1000))),
    giorniIncerti: false,
    vista: property.updated_at ? new Date(property.updated_at).getTime() || 0 : 0,
    stato: property.mandate_status === "active" ? "La possiamo proporre" : property.mandate_status,
  };
}

export function RigaDiCasa({
  riga,
  compact = false,
  giudizioSempre = false,
  mostraChi = true,
}: Readonly<{
  riga: RigaCasa;
  /** In una colonna stretta la riga larga si sbriciola: qui va in verticale. */
  compact?: boolean;
  /** Dove il giudizio è il soggetto della pagina, si scrive anche se è basso. */
  giudizioSempre?: boolean;
  /** Nella pagina di un'agenzia il suo nome su ogni riga è solo rumore. */
  mostraChi?: boolean;
}>) {
  const giudizioParla =
    riga.segnali != null && (giudizioSempre || riga.segnali.livello !== "bassa");

  return (
    <article className="group relative flex items-stretch gap-3 border-t border-[var(--lr-line-quiet)] p-3 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]">
      <Link href={`/casa/${riga.id}`} className="absolute inset-0 z-0" aria-label={riga.indirizzo} />
      <Stripe tone={TONO[riga.chi]} />

      {/* La foto è il soggetto, non la decorazione. */}
      <span
        className={clsx(
          "relative z-10 block shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]",
          compact ? "h-16 w-24" : "h-24 w-32 sm:h-28 sm:w-40",
        )}
      >
        {riga.foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${riga.foto}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
            Senza foto
          </span>
        )}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        {/* Chi la tiene: un'icona e un nome, senza etichette in più. */}
        {mostraChi ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            <span className="inline-flex items-center gap-1.5">
              {riga.chi === "privato" || riga.chi === "noi" ? (
                <UserRound
                  aria-hidden="true"
                  className={clsx(
                    "size-3.5",
                    riga.chi === "privato" ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink)]",
                  )}
                />
              ) : (
                <Building2 aria-hidden="true" className="size-3.5" />
              )}
              {riga.chi === "noi" ? (
                <span className="font-medium text-[var(--lr-ink)]">La teniamo noi</span>
              ) : riga.chi === "privato" ? (
                <span className="text-[var(--lr-warn)]">Da privato</span>
              ) : riga.agenzia ? (
                <Fonte name={formatShouty(riga.agenzia)} />
              ) : (
                <span>{riga.stato}</span>
              )}
            </span>
            {riga.altreAgenzie > 0 ? <span>e altre {riga.altreAgenzie}</span> : null}
            {riga.zona ? <span>{formatShouty(riga.zona)}</span> : null}
            {riga.rilanci > 0 ? (
              <span
                className="inline-flex items-center gap-1"
                title={`Ripubblicata ${riga.rilanci} volte: l'annuncio è stato rilanciato, ma la casa è sul mercato da prima`}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {riga.rilanci}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Alcune fonti danno solo la zona: si scrive tratteggiato, perché
          * non è l'indirizzo della casa ma il posto dove sta. */}
        <h3 className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
          <Dato
            certainty={riga.indirizzoDedotto ? "guess" : "sure"}
            hint={riga.indirizzoDedotto ? "La fonte non dà l'indirizzo: è la zona" : undefined}
          >
            {riga.indirizzo}
          </Dato>
        </h3>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          {riga.prezzo != null ? (
            <b className="font-[650] text-[var(--lr-ink)]">
              {formatCurrency(riga.prezzo)}
              {riga.affitto ? " al mese" : ""}
            </b>
          ) : (
            <DatoAssente label="prezzo non indicato" />
          )}
          {riga.mq != null ? <span>{formatNumber(riga.mq)} mq</span> : null}
          {!compact && riga.locali != null ? <span>{formatNumber(riga.locali)} locali</span> : null}
          {!compact && riga.giorni != null ? (
            <Periodo from={`da almeno ${formatDays(riga.giorni)}`} uncertain={riga.giorniIncerti} />
          ) : null}
          {compact && giudizioParla && riga.segnali ? (
            <span className="font-[650] text-[var(--lr-ink)]">
              {riga.segnali.livello === "alta" ? "Da chiamare" : "Vale un'occhiata"}
            </span>
          ) : null}
        </div>

        {giudizioParla && riga.segnali?.motivo ? (
          <p
            className={clsx(
              "truncate text-[length:var(--lr-text-meta)]",
              riga.segnali.livello === "alta" ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink-3)]",
            )}
          >
            {riga.segnali.motivo}
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
          {giudizioParla && riga.segnali ? (
            <Giudizio
              livello={riga.segnali.livello}
              signals={riga.segnali.indizi}
              total={riga.segnali.totale}
              align="right"
            />
          ) : riga.segnali ? null : (
            <Meta>{riga.stato}</Meta>
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

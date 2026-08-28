import { clsx } from "clsx";
import { BedDouble, Building2, Ruler, Store, UserRound } from "lucide-react";

import {
  MovimentoDiPrezzo,
  contornoDelMovimento,
  haMovimentoDiPrezzo,
} from "@/components/market-move";
import { Dato } from "@/components/ui/atoms";
import { Chip, RowAction, RowLink, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatDays, formatNumber, formatShouty } from "@/lib/formatting";
import { lifecycleEventLabel } from "@/lib/property-lifecycle/read-models/presentation";
import type { LifecycleEventItem } from "@/lib/property-lifecycle/read-models/types";

/**
 * Un movimento di mercato, come scheda fotografica.
 *
 * La prima lettura della giornata è fotografica: si riconosce la casa dalla
 * foto, il movimento dallo stato sovrapposto, e il prezzo dal monospaziato.
 * La riga compatta continua a esistere altrove — qui la parete di schede
 * serve a far vedere in un colpo d'occhio cosa si è mosso.
 *
 * La scheda non inventa comandi: l'unica azione che il prodotto conosce per un
 * movimento è aprire la casa, ed è quella che copre l'intera superficie.
 */

/** Ogni movimento porta il suo tono semantico: mai l'accento, che è dell'azione. */
const TONO_EVENTO: Record<string, Tone> = {
  PRICE_DROP: "danger",
  PRICE_INCREASE: "info",
  PRICE_CHANGED: "info",
  AGENCY_TO_PRIVATE: "info",
  AGENCY_SWITCH_DETECTED: "info",
  PRIVATE_RELIST: "warn",
  PRIVATE_RELIST_CONFLICT: "warn",
  PUBLICATION_RELAUNCHED: "warn",
  PUBLICATION_REAPPEARED: "warn",
  PRIVATE_PUBLICATION_REAPPEARED: "warn",
  NEW_LISTING: "action",
  MANUAL_OVERRIDE_RECORDED: "neutral",
  SOURCE_MARKED_SOLD: "neutral",
  PUBLICATION_REMOVED: "neutral",
  PRIVATE_PUBLICATION_REMOVED: "neutral",
  DISAPPEARED_CONFIRMED: "neutral",
  POST_EXIT_CLASSIFIED: "neutral",
};

/** Fuori dal mercato: il prezzo resta leggibile, ma non è più un'offerta. */
function fuoriMercato(propertyState: string) {
  return propertyState === "SOLD" || propertyState.startsWith("OFF_MARKET");
}

/** Da quanto è sotto osservazione: è un limite inferiore, non una data certa. */
function giorniInOsservazione(firstSeenAt: string, now: number) {
  const inizio = new Date(firstSeenAt).getTime();
  if (Number.isNaN(inizio)) return null;

  const giorni = Math.floor((now - inizio) / (24 * 60 * 60 * 1000));
  return giorni > 0 ? formatDays(giorni) : null;
}

export function DashboardEventCard({
  event,
  foto,
  now,
}: Readonly<{ event: LifecycleEventItem; foto?: string; now: number }>) {
  const property = event.property;
  const dove = formatShouty(property.address ?? property.title);
  const agenzia = property.agencies[0];
  const privato = !agenzia && property.activePrivateCount > 0;
  const siMuove = haMovimentoDiPrezzo(event.payload);
  const nota = siMuove ? null : contornoDelMovimento(event.payload);
  const daQuanto = giorniInOsservazione(property.firstSeenAt, now);
  const uscito = fuoriMercato(property.propertyState);

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] transition-colors focus-within:border-[var(--lr-accent)] hover:border-[var(--lr-ink-3)]">
      <RowLink
        href={`/casa/${event.propertyId}`}
        label={`${lifecycleEventLabel(event.eventType)}: ${dove}`}
      />

      {/* La foto è la prima lettura: lo stato le si posa sopra, non sotto. */}
      <div className="relative aspect-[16/9] overflow-hidden bg-[var(--lr-raised)]">
        {foto ? (
          <span
            className="block size-full bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.02]"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center text-[var(--lr-ink-3)]">
            <Building2 aria-hidden="true" className="size-8" />
          </span>
        )}
        <Chip
          tone={TONO_EVENTO[event.eventType] ?? "neutral"}
          dot
          className="absolute left-3 top-3 bg-[var(--lr-surface)]"
        >
          <Dato
            certainty={
              event.actorType === "USER" || event.confidence >= 0.85 ? "sure" : "guess"
            }
            hint={event.actorType === "USER" ? "Registrato da una persona" : undefined}
          >
            {lifecycleEventLabel(event.eventType)}
          </Dato>
        </Chip>
        {property.representativeImagePaths.length > 1 ? (
          <span className="absolute right-3 top-3 rounded-full bg-[var(--lr-surface)] px-2 py-0.5 font-mono text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
            {formatNumber(property.representativeImagePaths.length)} foto
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-[length:var(--lr-text-record)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
            {dove}
          </h3>
          {property.currentPrice != null ? (
            <b
              className={clsx(
                "shrink-0 font-mono text-[length:var(--lr-text-record)]",
                /* Un prezzo che non è più un'offerta si legge barrato. */
                uscito
                  ? "font-medium text-[var(--lr-ink-3)] line-through"
                  : "font-[650] text-[var(--lr-ink)]",
              )}
              title={uscito ? "Ultimo prezzo prima dell'uscita dal mercato" : undefined}
            >
              {formatCurrency(property.currentPrice)}
            </b>
          ) : null}
        </div>

        {/* I dati della casa: icona e numero, la stessa terna in ogni scheda. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
          {property.surfaceSqm != null ? (
            <span className="inline-flex items-center gap-1.5">
              <Ruler aria-hidden="true" className="size-4 text-[var(--lr-ink-3)]" />
              <span className="font-mono">{formatNumber(property.surfaceSqm)}</span> mq
            </span>
          ) : null}
          {property.rooms != null ? (
            <span className="inline-flex items-center gap-1.5">
              <BedDouble aria-hidden="true" className="size-4 text-[var(--lr-ink-3)]" />
              <span className="font-mono">{formatNumber(property.rooms)}</span> vani
            </span>
          ) : null}
          {property.locality ? (
            <span className="truncate">{formatShouty(property.locality)}</span>
          ) : null}
        </div>

        {/* Chi la tiene, e da quanto la guardiamo. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
          {privato ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--lr-info)]">
              <UserRound aria-hidden="true" className="size-4" />
              Privato probabile
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Store aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
              <span className="truncate">
                {agenzia ? formatShouty(agenzia.name) : "Fonte non attribuita"}
              </span>
            </span>
          )}
          {daQuanto ? (
            <>
              <span aria-hidden="true" className="h-3.5 w-px bg-[var(--lr-line-quiet)]" />
              <span className="font-mono text-[var(--lr-ink-3)]">{daQuanto}</span>
            </>
          ) : null}
        </div>

        {/* Il piede tiene il movimento e il momento: due fatti, nessun comando. */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--lr-line-quiet)] pt-3 text-[length:var(--lr-text-meta)]">
          {/* Il prezzo raggiunto sta già in testa alla scheda: qui resta solo
            * di quanto si è mosso, come nel riferimento. */}
          <span className="min-w-0 truncate">
            {siMuove ? (
              <MovimentoDiPrezzo payload={event.payload} sinceClassName="hidden" />
            ) : (
              nota
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-[var(--lr-ink-3)]">
            {formatDate(event.occurredAt)}
            <RowAction />
          </span>
        </div>
      </div>
    </article>
  );
}

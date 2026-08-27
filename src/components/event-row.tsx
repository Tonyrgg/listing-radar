import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  MovimentoDiPrezzo,
  contornoDelMovimento,
  haMovimentoDiPrezzo,
} from "@/components/market-move";
import { Dato } from "@/components/ui/atoms";
import { Stripe, type Tone } from "@/components/ui/primitives";
import { formatDate, formatShouty, formatTime } from "@/lib/formatting";
import { lifecycleEventLabel } from "@/lib/property-lifecycle/read-models/presentation";
import type { LifecycleEventItem } from "@/lib/property-lifecycle/read-models/types";

/**
 * Un movimento di mercato, in una riga.
 *
 * Prima erano tre righe di testo: cosa è successo, a quale casa, quando. La
 * casa però si riconosce dalla foto, e il movimento — un prezzo che scende —
 * si riconosce dalla freccia. Restano parole solo dove non c'è forma.
 */

/** I movimenti che vale la pena colorare: il resto è cronaca. */
const TONO_EVENTO: Record<string, Tone> = {
  PRICE_DROP: "warn",
  AGENCY_TO_PRIVATE: "warn",
  PRIVATE_RELIST: "warn",
  SOURCE_MARKED_SOLD: "info",
  PUBLICATION_REMOVED: "info",
  DISAPPEARED_CONFIRMED: "info",
};

export function EventRow({
  event,
  foto,
  href,
  mostraOra = false,
}: Readonly<{
  event: LifecycleEventItem;
  foto?: string;
  href?: string;
  /** Dentro una giornata la data è già nel titolo: qui serve l'ora. */
  mostraOra?: boolean;
}>) {
  const property = event.property;
  const dove = property.address ? formatShouty(property.address) : formatShouty(property.title);
  const siMuove = haMovimentoDiPrezzo(event.payload);
  const nota = siMuove ? null : contornoDelMovimento(event.payload);

  return (
    <article className="group relative flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-3 py-2.5 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]">
      <Link
        href={href ?? `/casa/${event.propertyId}`}
        className="absolute inset-0 z-0"
        aria-label={`${lifecycleEventLabel(event.eventType)}: ${dove}`}
      />
      <Stripe tone={TONO_EVENTO[event.eventType] ?? "neutral"} />

      <span className="relative z-10 block h-14 w-20 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]">
        {foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : null}
      </span>

      <span className="relative z-10 flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
          <Dato
            certainty={event.actorType === "USER" ? "sure" : event.confidence >= 0.85 ? "sure" : "guess"}
            hint={event.actorType === "USER" ? "Registrato da una persona" : undefined}
          >
            {lifecycleEventLabel(event.eventType)}
          </Dato>
        </span>
        <span className="truncate text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {dove}
          {property.agencies[0] ? ` · ${formatShouty(property.agencies[0].name)}` : ""}
        </span>
      </span>

      {/* Il blocco di destra può stringersi: con `shrink-0` un ribasso scritto
        * per esteso spingeva la riga fuori dallo schermo. */}
      <span className="relative z-10 flex min-w-0 shrink items-center justify-end gap-3">
        <span className="truncate text-[length:var(--lr-text-meta)]">
          {siMuove ? (
            <MovimentoDiPrezzo payload={event.payload} sinceClassName="hidden sm:inline" />
          ) : (
            nota
          )}
        </span>
        <span className="hidden whitespace-nowrap text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)] sm:inline">
          {mostraOra ? formatTime(event.occurredAt) : formatDate(event.occurredAt)}
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 text-[var(--lr-ink-3)] transition-colors group-hover:text-[var(--lr-ink)]"
        />
      </span>
    </article>
  );
}

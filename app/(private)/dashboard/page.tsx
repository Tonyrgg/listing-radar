import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { Badge, getSellerTypeTone } from "@/components/badge";
import {
  Banda,
  FasciaVuota,
  RigaMovimento,
  StrisciaFiducia,
} from "@/components/home-bands";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { Chip, Meta, Stripe, buttonClass } from "@/components/ui/primitives";
import { Dato, Fonte, Periodo } from "@/components/ui/atoms";
import { readNow } from "@/lib/clock";
import { getDashboardSummary } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import { getIncomingDashboardData } from "@/lib/incoming/repository";
import { getSellerTypeLabel, getSourceLabel } from "@/lib/labels";
import { getListingAttentionReason } from "@/lib/listings/operational";
import { lifecycleEventLabel } from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import { getSourcesSummary } from "@/lib/sources-health";
import type { IncomingListing, Listing } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Oggi" };

/* Gli eventi che raccontano un movimento di mercato: gli altri sono rumore
 * tecnico e non meritano una riga nella home. */
const EVENTI_DA_MOSTRARE = new Set([
  "PRICE_DROP",
  "PRICE_INCREASE",
  "AGENCY_TO_PRIVATE",
  "AGENCY_SWITCH_DETECTED",
  "PUBLICATION_REMOVED",
  "DISAPPEARED_CONFIRMED",
  "PUBLICATION_REAPPEARED",
  "PRIVATE_PUBLICATION_REAPPEARED",
  "SOURCE_MARKED_SOLD",
  "PUBLICATION_RELAUNCHED",
  "NEW_LISTING",
]);

function toneEvento(eventType: string) {
  if (eventType === "PRICE_DROP" || eventType === "SOURCE_MARKED_SOLD") return "warn" as const;
  if (eventType.includes("PRIVATE") || eventType.includes("SWITCH")) return "info" as const;
  return "neutral" as const;
}

function quando(value: string, now: number) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";

  const giorni = Math.floor((now - time) / (24 * 60 * 60 * 1000));
  if (giorni <= 0) return "oggi";
  if (giorni === 1) return "ieri";
  if (giorni < 7) return `${giorni} giorni`;
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(time);
}

function portalImportUrl(listing: IncomingListing) {
  const value = listing.canonicalUrl ?? listing.url;

  try {
    const url = new URL(value);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.set("listing-radar", listing.id);
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return value;
  }
}

function attesa(listing: IncomingListing, now: number) {
  const value = listing.emailReceivedAt ?? listing.createdAt;
  const time = value ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(time)) return { testo: "arrivato di recente", giorni: 0 };

  const giorni = Math.floor((now - time) / (24 * 60 * 60 * 1000));
  if (giorni <= 0) return { testo: "arrivato oggi", giorni };
  if (giorni === 1) return { testo: "in attesa da ieri", giorni };
  return { testo: `in attesa da ${giorni} giorni`, giorni };
}

function RigaArrivo({
  listing,
  now,
}: Readonly<{ listing: IncomingListing; now: number }>) {
  const stato = attesa(listing, now);

  return (
    <div className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-4 py-3 first:border-t-0">
      <Stripe tone={stato.giorni >= 2 ? "warn" : "neutral"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug text-[var(--lr-ink)]">
          {listing.title}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
          {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
          {listing.zone ? <span>{formatPlainText(listing.zone)}</span> : null}
        </div>
        <Meta className="mt-1">
          <Fonte name={getSourceLabel(listing.source)} /> · {stato.testo}
        </Meta>
      </div>
      <a
        href={portalImportUrl(listing)}
        target="_blank"
        rel="noreferrer"
        className={buttonClass("secondary", { compact: true })}
      >
        Completa
      </a>
    </div>
  );
}

function RigaOccasione({
  listing,
  scoringConfig,
}: Readonly<{
  listing: Listing;
  scoringConfig: Awaited<ReturnType<typeof getPersistedScoringConfig>>;
}>) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-4 py-3 first:border-t-0">
      <Stripe tone={listing.isPriceDropped ? "warn" : "neutral"} />
      <Link
        href={`/listings/${listing.id}`}
        className="block h-14 w-20 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]"
        aria-label={`Apri la scheda di ${listing.title}`}
      >
        {listing.imageUrls[0] ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${listing.imageUrls[0]}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center px-1 text-center text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
            Senza foto
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={getSellerTypeTone(listing.sellerType)}>
            <Dato certainty={listing.sellerType === "unknown" ? "unknown" : "guess"}>
              {getSellerTypeLabel(listing.sellerType)}
            </Dato>
          </Badge>
          <Meta className="truncate">
            <Fonte name={getSourceLabel(listing.source)} />
          </Meta>
        </div>
        <Link
          href={`/listings/${listing.id}`}
          className="mt-1 block truncate text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)] hover:underline"
        >
          {listing.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
          {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
          <Periodo
            from={`da almeno ${formatNumber(listing.minimumDaysOnline)} giorni`}
            uncertain
          />
        </div>
        <p
          className={
            listing.isPriceDropped
              ? "mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-warn)]"
              : "mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]"
          }
        >
          {getListingAttentionReason(listing)}
        </p>
      </div>
      <div className="shrink-0">
        <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
      </div>
    </div>
  );
}

export default async function TodayPage() {
  await connection();

  const [summary, incoming, scoringConfig, sources, movimenti, now] = await Promise.all([
    getDashboardSummary(),
    getIncomingDashboardData(),
    getPersistedScoringConfig(),
    getSourcesSummary(),
    loadLifecycleView((repository) => repository.dashboard()),
    readNow(),
  ]);

  const occasioni = summary.watchlist.slice(0, 4);
  const arrivi = incoming.pendingListings.slice(0, 5);
  const eventi = (movimenti.data?.recentEvents ?? [])
    .filter((event) => EVENTI_DA_MOSTRARE.has(event.eventType))
    .slice(0, 6);

  const oggi = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(now));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={oggi.charAt(0).toUpperCase() + oggi.slice(1)}
        title="Oggi"
        actions={
          <>
            <RefreshEmailButton />
            <QuickRequestButton />
          </>
        }
      />

      {/* Fascia 0 — quanto puoi fidarti di quello che stai per leggere. */}
      <StrisciaFiducia sources={sources} />

      {/* Fascia 1 — cosa è cambiato senza di te. */}
      <Banda
        numero={1}
        titolo="Cosa si è mosso"
        conteggio={eventi.length ? <Chip tone="info">{eventi.length} movimenti</Chip> : null}
        azione={
          eventi.length ? (
            <Link href="/lifecycle" className={buttonClass("quiet", { compact: true })}>
              Tutti i segnali
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      >
        {eventi.length ? (
          <div>
            {eventi.map((event) => (
              <RigaMovimento
                key={event.id}
                href={`/lifecycle/archive/${event.propertyId}`}
                tone={toneEvento(event.eventType)}
                titolo={event.property.address ?? event.property.title}
                dettaglio={`${lifecycleEventLabel(event.eventType)}${
                  event.property.currentPrice != null
                    ? ` · ${formatCurrency(event.property.currentPrice)}`
                    : ""
                }`}
                quando={quando(event.occurredAt, now)}
              />
            ))}
          </div>
        ) : (
          <FasciaVuota
            titolo={movimenti.available ? "Il mercato è fermo" : "I segnali non sono disponibili"}
            descrizione={
              movimenti.available
                ? "Nessun ribasso, uscita o passaggio di agenzia da quando hai guardato l'ultima volta."
                : "Questa sezione lavora su un archivio separato che non risulta pronto. Il resto della pagina funziona normalmente."
            }
          />
        )}
      </Banda>

      {/* Fascia 2 — cosa chiede il tuo lavoro. */}
      <Banda
        numero={2}
        titolo="Cosa è arrivato di nuovo"
        conteggio={
          incoming.pendingCount ? (
            <Chip tone="warn">{incoming.pendingCount} da completare</Chip>
          ) : null
        }
        azione={
          arrivi.length ? (
            <Link href="/incoming" className={buttonClass("quiet", { compact: true })}>
              Vedi tutti
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      >
        {arrivi.length ? (
          <div>
            {arrivi.map((listing) => (
              <RigaArrivo key={listing.id} listing={listing} now={now} />
            ))}
          </div>
        ) : (
          <FasciaVuota
            titolo="Hai completato tutta la coda"
            descrizione={
              incoming.lastEmailCheck
                ? `Nessuna segnalazione da completare. L'ultimo controllo delle email è delle ${new Intl.DateTimeFormat(
                    "it-IT",
                    { hour: "2-digit", minute: "2-digit" },
                  ).format(new Date(incoming.lastEmailCheck.processedAt))}.`
                : "Nessuna segnalazione da completare. Il controllo automatico parte da solo."
            }
            azione={<RefreshEmailButton />}
          />
        )}
      </Banda>

      {/* Fascia 3 — il giudizio. */}
      <Banda
        numero={3}
        titolo="Cosa conviene guardare adesso"
        conteggio={
          summary.highPriority ? (
            <Chip tone="neutral">{summary.highPriority} in evidenza</Chip>
          ) : null
        }
        azione={
          occasioni.length ? (
            <Link
              href="/listings?onlyHighPriority=on&sortBy=score_desc"
              className={buttonClass("quiet", { compact: true })}
            >
              Tutte
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      >
        {occasioni.length ? (
          <div>
            {occasioni.map((listing) => (
              <RigaOccasione key={listing.id} listing={listing} scoringConfig={scoringConfig} />
            ))}
          </div>
        ) : (
          <FasciaVuota
            titolo="Nessuna occasione in evidenza"
            descrizione="Nessuna scheda supera oggi la soglia di appetibilità. La soglia si regola dalle impostazioni."
            azione={
              <Link href="/settings" className={buttonClass("secondary", { compact: true })}>
                Regola la soglia
              </Link>
            }
          />
        )}
      </Banda>

      <Meta className="px-1">
        Ultimo controllo delle email{" "}
        {incoming.lastEmailCheck
          ? formatDateTime(incoming.lastEmailCheck.processedAt)
          : "non ancora eseguito"}
        .
      </Meta>
    </div>
  );
}

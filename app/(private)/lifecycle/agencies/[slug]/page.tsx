import { ExternalLink, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import { PageHeader } from "@/components/page-header";
import { PropertyRow } from "@/components/property-row";
import { Fonte, type SourceHealth } from "@/components/ui/atoms";
import { Card, CardBody, CardHeader, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { formatDateTime, formatNumber, formatShouty } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

import { enqueueAgencyLifecycleRefresh } from "../../actions";
import { LifecycleUnavailable, ageDays } from "../../_components/ui";
import styles from "../../lifecycle.module.css";

export const metadata: Metadata = { title: "Cosa tiene questa agenzia" };

/**
 * Cosa tiene un'agenzia.
 *
 * Prima un terzo della pagina era il registro del crawler — dieci righe
 * «HEALTHY · 109 in area · 3 esclusi · 0 errori» — accanto a un inventario
 * senza nemmeno una foto. Il registro serve, ma è una nota a piè di pagina:
 * il soggetto sono le case.
 */

const FILTRI = [
  { chiave: "tutti", etichetta: "Tutte" },
  { chiave: "nuovi", etichetta: "Arrivate da poco" },
  { chiave: "fresche", etichetta: "Da meno di 3 mesi" },
  { chiave: "ferme", etichetta: "Ferme da oltre 5 mesi" },
  { chiave: "ribassate", etichetta: "Con il prezzo sceso" },
  { chiave: "uscite", etichetta: "Non le tiene più" },
  { chiave: "vendute", etichetta: "Vendute" },
] as const;

type Filtro = (typeof FILTRI)[number]["chiave"];

function passaIlFiltro(
  property: LifecyclePropertySummary,
  slug: string,
  filtro: Filtro,
  now: number,
  nuove: Set<string>,
  ribassate: Set<string>,
) {
  const mandato = property.agencies.find((item) => item.slug === slug);
  const giorni = ageDays(property.trueMarketStartUpperBound, now);

  if (filtro === "nuovi") return nuove.has(property.id);
  if (filtro === "fresche") return giorni != null && giorni < 90;
  if (filtro === "ferme") return giorni != null && giorni >= 150;
  if (filtro === "ribassate") return ribassate.has(property.id);
  if (filtro === "uscite") return mandato?.state !== "ACTIVE";
  if (filtro === "vendute") {
    return mandato?.state === "CLOSED_SOLD" || property.saleStatus === "SOLD_CONFIRMED";
  }

  return true;
}

/** Come sta la fonte, in una parola invece che in dieci righe di registro. */
function salute(stato: string | null): { salute: SourceHealth; parola: string } {
  const valore = String(stato ?? "").toUpperCase();
  if (valore === "HEALTHY") return { salute: "healthy", parola: "letta per intero" };
  if (valore === "DEGRADED") return { salute: "partial", parola: "letta solo in parte" };
  if (valore === "FAILED") return { salute: "broken", parola: "non ha risposto" };
  if (valore === "STRUCTURE_CHANGED") {
    return { salute: "broken", parola: "il sito ha cambiato struttura" };
  }
  return { salute: "unknown", parola: "mai controllata" };
}

export default async function AgenziaPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();

  const { slug } = await params;
  const query = await searchParams;
  const richiesto = Array.isArray(query.mostra) ? query.mostra[0] : query.mostra;
  const filtro: Filtro = FILTRI.some((voce) => voce.chiave === richiesto)
    ? (richiesto as Filtro)
    : "tutti";

  const [view, now] = await Promise.all([
    loadLifecycleView((repository) => repository.agency(slug)),
    readNow(),
  ]);

  if (!view.available) return <LifecycleUnavailable message={view.message} />;
  if (!view.data) notFound();

  const detail = view.data;
  const nuove = new Set(detail.newPropertyIds);
  const ribassate = new Set(detail.priceReducedPropertyIds);
  const inventario = detail.inventory.filter((property) =>
    passaIlFiltro(property, slug, filtro, now, nuove, ribassate),
  );

  const visibili = inventario.slice(0, 60);
  const foto = await signPropertyPhotos(visibili);
  const ultimo = detail.recentRuns[0];
  const stato = salute(ultimo?.healthState ?? detail.agency.latestHealth);
  const nome = formatShouty(detail.agency.name);

  return (
    <>
      <PageHeader
        eyebrow="Agenzia"
        title={nome}
        description={[
          `Tiene ${formatNumber(detail.agency.activeCount)} case in vendita`,
          detail.agency.exitedCount
            ? `${formatNumber(detail.agency.exitedCount)} le sono uscite di mano`
            : null,
          detail.agency.soldCount
            ? `${formatNumber(detail.agency.soldCount)} risultano vendute`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
          .concat(".")}
        backHref="/fonti"
        backLabel="Torna alle fonti"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {detail.agency.websiteUrl ? (
              <a
                href={detail.agency.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("quiet", { compact: true })}
              >
                Il loro sito
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            ) : null}
            <form action={enqueueAgencyLifecycleRefresh}>
              <input type="hidden" name="agencySlug" value={slug} />
              <PendingSubmitButton
                type="submit"
                pendingLabel="Metto in coda"
                icon={<RefreshCw aria-hidden="true" className="size-4" />}
                className={styles.secondaryAction}
              >
                Rileggi il loro sito
              </PendingSubmitButton>
            </form>
          </div>
        }
      />

      {/* Come sta la fonte: una riga, non una colonna. */}
      <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <Fonte name={nome} health={stato.salute} /> — {stato.parola}
          {ultimo
            ? `, l'ultima volta il ${formatDateTime(ultimo.finishedAt ?? ultimo.startedAt)}`
            : ""}
        </span>
        {ultimo ? (
          <Meta>
            {formatNumber(ultimo.inScopeCount)} case in zona
            {ultimo.excludedCount
              ? ` · ${formatNumber(ultimo.excludedCount)} fuori dai nostri comuni`
              : ""}
            {ultimo.errorCount
              ? ` · ${formatNumber(ultimo.errorCount)} ${ultimo.errorCount === 1 ? "errore" : "errori"}`
              : ""}
          </Meta>
        ) : null}
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTRI.map((voce) => (
          <Link
            key={voce.chiave}
            href={
              voce.chiave === "tutti"
                ? `/lifecycle/agencies/${slug}`
                : `/lifecycle/agencies/${slug}?mostra=${voce.chiave}`
            }
            className={buttonClass(filtro === voce.chiave ? "secondary" : "quiet", {
              compact: true,
            })}
            aria-current={filtro === voce.chiave ? "page" : undefined}
          >
            {voce.etichetta}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title={`${formatNumber(inventario.length)} ${inventario.length === 1 ? "casa" : "case"}`}
          meta="Ogni riga è la casa vera, non l'annuncio: gli annunci ripubblicati restano una casa sola."
        />
        {visibili.length ? (
          <div>
            {visibili.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                foto={foto.get(property.id)}
                now={now}
                mostraFonte={false}
              />
            ))}
          </div>
        ) : (
          <CardBody>
            <EmptyState
              title="Niente con questo filtro"
              description="Prova a guardare tutte le case che tiene questa agenzia."
              action={
                <Link
                  href={`/lifecycle/agencies/${slug}`}
                  className={buttonClass("secondary", { compact: true })}
                >
                  Mostra tutte
                </Link>
              }
            />
          </CardBody>
        )}
      </Card>

      {inventario.length > visibili.length ? (
        <Meta className="px-1">
          Ne vedi {formatNumber(visibili.length)} di {formatNumber(inventario.length)}: usa i
          filtri qui sopra per arrivare alle altre.
        </Meta>
      ) : null}
    </>
  );
}

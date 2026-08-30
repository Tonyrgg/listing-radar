import { clsx } from "clsx";
import {
  ArrowRight,
  ExternalLink,
  GitCompareArrows,
  MapPin,
  MapPinOff,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import { Dato } from "@/components/ui/atoms";
import {
  Campo,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Label,
  Meta,
  Testo,
  buttonClass,
} from "@/components/ui/primitives";
import { getCurrentUser } from "@/lib/auth";
import { formatCurrency, formatNumber, formatShouty } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import {
  geographyReasonLabel,
  humanize,
  locationPrecisionLabel,
  reviewTypeLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { vistaRecensioni } from "@/lib/property-lifecycle/read-models/server";
import type {
  LifecyclePropertySummary,
  LifecycleReviewItem,
} from "@/lib/property-lifecycle/read-models/types";

import {
  recordReviewDecision,
} from "../actions";
import { LifecycleHeader, LifecycleUnavailable } from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Da decidere" };

/**
 * Il confronto.
 *
 * «Sono la stessa casa?» è una domanda che si risponde guardando: due foto
 * accanto, e in un istante sai. Prima questa pagina metteva in fila
 * centonovantacinque casi tutti insieme, ognuno con quattro riquadri di testo,
 * nessuna immagine, e un titolo scritto in inglese dal database.
 *
 * Ora si decide un caso alla volta, con le foto grandi e le differenze
 * segnate. Gli altri restano sotto, in coda, con la loro miniatura.
 */

const DA_MOSTRARE_IN_CODA = 8;

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** La domanda che il caso pone, in italiano e senza gergo. */
function domanda(review: LifecycleReviewItem) {
  if (review.reviewType === "IDENTITY") return "È la stessa casa?";
  if (review.reviewType === "GEOGRAPHY") return "Dove si trova davvero?";
  if (review.reviewType === "LIFECYCLE") return "In che stato è?";
  return reviewTypeLabel(review.reviewType);
}

function nome(property: LifecyclePropertySummary) {
  return formatShouty(property.address ?? property.title);
}

/**
 * Un caso di posizione non ha una scheda dietro, e non è un errore.
 *
 * Quando il risolutore non sa dire se un annuncio è a Bitonto, la sincronia lo
 * lascia fuori dall'archivio proprio perché non sa dove metterlo: la proprietà
 * non nasce, e il caso porta con sé solo l'indirizzo grezzo e il link. La
 * pagina lo leggeva come una scheda mancante e scriveva «non c'è più», che è
 * la storia di una cosa cancellata invece di una mai entrata.
 */
type ProveGeografiche = {
  indirizzo: string | null;
  ragioni: string[];
  precisione: string | null;
  link: string | null;
  coordinate: string | null;
  cap: string | null;
};

function testo(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function proveGeografiche(details: Record<string, unknown>): ProveGeografiche {
  const location = (details.location ?? {}) as Record<string, unknown>;
  const latitude = location.latitude;
  const longitude = location.longitude;
  return {
    indirizzo: testo(location.rawText),
    ragioni: Array.isArray(location.reasons)
      ? location.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    precisione: testo(location.precision),
    link: testo(details.canonicalUrl),
    coordinate:
      typeof latitude === "number" && typeof longitude === "number"
        ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
        : null,
    cap: testo(location.postalCode),
  };
}

/** Le prove che ha il caso di posizione: l'indirizzo com'è scritto, e perché non basta. */
function SchedaPosizione({
  prove,
  agenzia,
}: Readonly<{ prove: ProveGeografiche; agenzia: string | null }>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Come lo scrive l&apos;annuncio</Label>
        <p className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)]">
          <Dato certainty={prove.indirizzo ? "guess" : "unknown"}>
            {prove.indirizzo ?? "Nessun indirizzo nell'annuncio"}
          </Dato>
        </p>
        <Meta>
          {[
            agenzia ? formatShouty(agenzia) : null,
            prove.precisione ? locationPrecisionLabel(prove.precisione) : null,
            prove.cap ? `CAP ${prove.cap}` : null,
            prove.coordinate,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </Meta>
      </div>

      {prove.ragioni.length ? (
        <div className="space-y-1">
          <Label tone="warn">Perché non sappiamo dire dov&apos;è</Label>
          <ul className="space-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
            {prove.ragioni.map((ragione) => (
              <li key={ragione}>{geographyReasonLabel(ragione)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {prove.link ? (
        <a
          href={prove.link}
          target="_blank"
          rel="noreferrer"
          className={buttonClass("quiet", { compact: true })}
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Apri l&apos;annuncio sul sito dell&apos;agenzia
        </a>
      ) : null}
    </div>
  );
}

/**
 * Una scheda del confronto: la foto grande, i numeri sotto.
 *
 * `diverso` segna i valori che non coincidono con la scheda in esame: è quello
 * che l'occhio cerca, e nel testo si perdeva.
 */
function SchedaConfronto({
  property,
  foto,
  etichetta,
  riferimento,
  punteggio,
  contraddizioni,
  piccola = false,
}: Readonly<{
  property: LifecyclePropertySummary;
  foto?: string;
  etichetta: string;
  riferimento?: LifecyclePropertySummary | null;
  punteggio?: number | null;
  contraddizioni?: string[];
  /** Le candidate di seconda fila non meritano lo stesso spazio della prima. */
  piccola?: boolean;
}>) {
  const diverso = (chiave: "currentPrice" | "surfaceSqm" | "rooms") =>
    riferimento != null && riferimento[chiave] !== property[chiave];

  const valore = (
    chiave: "currentPrice" | "surfaceSqm" | "rooms",
    testo: string,
  ) => (
    <span
      className={
        diverso(chiave)
          ? "text-[var(--lr-warn)]"
          : riferimento
            ? "text-[var(--lr-accent)]"
            : "text-[var(--lr-ink-2)]"
      }
      title={
        riferimento
          ? diverso(chiave)
            ? "Diverso dalla scheda in esame"
            : "Uguale alla scheda in esame"
          : undefined
      }
    >
      {testo}
    </span>
  );

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{etichetta}</Label>
        {punteggio != null ? (
          <Meta>si somigliano al {Math.round(punteggio * 100)}%</Meta>
        ) : null}
      </div>

      <Link
        href={`/casa/${property.id}`}
        className={clsx(
          "block w-full overflow-hidden rounded-[var(--lr-radius-card)] bg-[var(--lr-raised)]",
          /* Altezza fissa, non proporzione: due foto affiancate devono stare
           * nella stessa schermata dei bottoni con cui si decide. */
          piccola ? "h-32" : "h-56 sm:h-64",
        )}
        aria-label={`Apri la scheda di ${nome(property)}`}
      >
        {foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center px-4 text-center text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            Senza foto: qui il confronto va fatto sui numeri
          </span>
        )}
      </Link>

      <p className="truncate text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)]">
        <Dato certainty={property.address ? "sure" : "guess"}>
          {nome(property)}
        </Dato>
      </p>

      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[length:var(--lr-text-body)]">
        {valore("currentPrice", formatCurrency(property.currentPrice))}
        {property.surfaceSqm != null
          ? valore("surfaceSqm", `${formatNumber(property.surfaceSqm)} m²`)
          : null}
        {property.rooms != null
          ? valore("rooms", `${formatNumber(property.rooms)} locali`)
          : null}
      </p>

      <Meta>
        {property.agencies
          .map((agency) => formatShouty(agency.name))
          .join(" · ") || "—"}
      </Meta>

      {contraddizioni?.length ? (
        <Meta className="text-[var(--lr-warn)]">
          Non torna:{" "}
          {contraddizioni.map(humanize).join(", ").toLocaleLowerCase("it")}
        </Meta>
      ) : null}
    </div>
  );
}

export default async function DaDecidereePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();

  const query = await searchParams;
  const [view, user] = await Promise.all([
    vistaRecensioni(),
    getCurrentUser(),
  ]);

  if (!view.available || !view.data)
    return <LifecycleUnavailable message={view.message} />;

  const casi = view.data;

  if (!casi.length) {
    return (
      <>
        <LifecycleHeader
          eyebrow="Segnali"
          title="Non c'è niente da decidere"
          description="Quando due schede si somigliano troppo per essere sicuri, il caso finisce qui."
        />
        <Card>
          <CardBody>
            <EmptyState
              title="La coda è vuota"
              description="Nessuna ambiguità aspetta una tua decisione in questo momento."
            />
          </CardBody>
        </Card>
      </>
    );
  }

  const richiesto = param(query.caso);
  const indice =
    Math.min(Math.max(Number(richiesto ?? "1") || 1, 1), casi.length) - 1;
  const caso = casi[indice];
  const prossimo = indice + 2 <= casi.length ? indice + 2 : null;

  /* Un caso di posizione non ha una scheda: la domanda è dov'è l'annuncio,
   * non a quale scheda somiglia. Le due pagine sono la stessa, ma le prove che
   * mostrano e le risposte che accettano non lo sono. */
  const posizione = caso.reviewType === "GEOGRAPHY";
  const prove = posizione ? proveGeografiche(caso.details) : null;

  const candidati = [...caso.candidates].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );
  const migliore = candidati[0] ?? null;
  const altri = candidati.slice(1);
  const coda = casi.slice(indice + 1, indice + 1 + DA_MOSTRARE_IN_CODA);

  const foto = await signPropertyPhotos([
    ...(caso.property ? [caso.property] : []),
    ...candidati.map((candidato) => candidato.property),
    ...coda.flatMap((altro) => (altro.property ? [altro.property] : [])),
  ]);

  const perTipo = (tipo: string) =>
    casi.filter((item) => item.reviewType === tipo).length;
  const esclusioniAutomatiche = casi.reduce(
    (totale, item) => totale + item.automaticExclusions.count,
    0,
  );

  return (
    <>
      <LifecycleHeader
        eyebrow="Segnali"
        title={domanda(caso)}
        description={
          posizione
            ? "L'annuncio non nomina un posto che sappiamo riconoscere: finché non lo dici tu, resta fuori dall'archivio."
            : "Il sistema elimina automaticamente confronti con vie, prezzi, metrature o locali incompatibili. Qui restano solo casi con prove ancora plausibili."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {esclusioniAutomatiche > 0 ? (
              <Chip tone="info">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {esclusioniAutomatiche}{" "}
                {esclusioniAutomatiche === 1
                  ? "confronto escluso"
                  : "confronti esclusi"}
              </Chip>
            ) : null}
            <Chip tone="warn">
              caso {indice + 1} di {casi.length}
            </Chip>
          </div>
        }
      />

      <Card className="flex flex-wrap divide-x divide-[var(--lr-line-quiet)]">
        {[
          [casi.length, "casi aperti"],
          [perTipo("IDENTITY"), "stessa casa?"],
          [perTipo("GEOGRAPHY"), "dove si trova?"],
          [perTipo("LIFECYCLE"), "in che stato è?"],
        ].map(([valore, cosa]) => (
          <div key={String(cosa)} className="min-w-0 px-4 py-3">
            <strong className="block text-[length:var(--lr-text-page)] font-[650] leading-none tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              {formatNumber(Number(valore))}
            </strong>
            <span className="mt-1.5 block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
              {cosa}
            </span>
          </div>
        ))}
      </Card>

      <Card>
        <CardHeader
          title={posizione ? "Leggi, e decidi" : "Guarda, e decidi"}
          meta={
            posizione
              ? "Bitonto, Palombaio e Mariotto sono la zona che seguiamo. Il resto no."
              : "In verde quello che coincide, in giallo quello che non torna."
          }
          action={
            prossimo ? (
              <Link
                href={`/lifecycle/review?caso=${prossimo}`}
                className={buttonClass("quiet", { compact: true })}
              >
                Salta al prossimo
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null
          }
        />
        <CardBody className="space-y-5">
          {prove ? <SchedaPosizione prove={prove} agenzia={caso.agencyName} /> : null}

          {posizione ? null : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
              {caso.property ? (
                <SchedaConfronto
                  property={caso.property}
                  foto={foto.get(caso.property.id)}
                  etichetta="La scheda in esame"
                />
              ) : (
                <EmptyState
                  title="La scheda in esame non c'è più"
                  description="Il caso resta aperto, ma la proprietà a cui si riferiva non è più nell'archivio."
                />
              )}

              {migliore ? (
                <SchedaConfronto
                  property={migliore.property}
                  foto={foto.get(migliore.property.id)}
                  etichetta="Le somiglia di più"
                  riferimento={caso.property}
                  punteggio={migliore.score}
                  contraddizioni={migliore.contradictions}
                />
              ) : null}
            </div>
          )}

          {altri.length ? (
            <div>
              <Label>Altre che le somigliano</Label>
              <div className="mt-2 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {altri.map((candidato) => (
                  <SchedaConfronto
                    key={candidato.property.id}
                    property={candidato.property}
                    foto={foto.get(candidato.property.id)}
                    etichetta="Candidata"
                    riferimento={caso.property}
                    punteggio={candidato.score}
                    contraddizioni={candidato.contradictions}
                    piccola
                  />
                ))}
              </div>
            </div>
          ) : null}

          {user ? (
            <form action={recordReviewDecision} className={styles.manualForm}>
              <input type="hidden" name="reviewId" value={caso.id} />
              {migliore ? (
                <input
                  type="hidden"
                  name="candidatePropertyId"
                  value={migliore.property.id}
                />
              ) : null}
              <Campo
                label={
                  posizione
                    ? "Come fai a dirlo?"
                    : "Cosa ti fa dire di sì o di no?"
                }
              >
                <Testo
                  name="reason"
                  required
                  minLength={5}
                  placeholder={
                    posizione
                      ? "Es. via Modugno è a Bitonto, la zona Santi Medici pure"
                      : "Es. stesse foto, stesso piano, prezzo diverso perché ribassato"
                  }
                />
              </Campo>
              <div className={styles.decisionGrid}>
                <PendingSubmitButton
                  type="submit"
                  name="decision"
                  value={posizione ? "IN_SCOPE" : "SAME"}
                  pendingLabel="Registro"
                  icon={
                    posizione ? (
                      <MapPin aria-hidden="true" className="size-4" />
                    ) : (
                      <GitCompareArrows aria-hidden="true" className="size-4" />
                    )
                  }
                  className={styles.primaryAction}
                >
                  {posizione ? "È nella zona che seguiamo" : "È la stessa casa"}
                </PendingSubmitButton>
                <PendingSubmitButton
                  type="submit"
                  name="decision"
                  value={posizione ? "OUT_OF_SCOPE" : "DIFFERENT"}
                  pendingLabel="Registro"
                  icon={
                    posizione ? (
                      <MapPinOff aria-hidden="true" className="size-4" />
                    ) : undefined
                  }
                  className={styles.secondaryAction}
                >
                  {posizione ? "È fuori zona" : "Sono due case diverse"}
                </PendingSubmitButton>
                <PendingSubmitButton
                  type="submit"
                  name="decision"
                  value="NOT_SURE"
                  pendingLabel="Registro"
                  icon={
                    <ShieldQuestion aria-hidden="true" className="size-4" />
                  }
                  className={styles.secondaryAction}
                >
                  Non riesco a dirlo
                </PendingSubmitButton>
              </div>
            </form>
          ) : (
            <EmptyState
              title="Per decidere serve essere riconosciuti"
              description="Ogni decisione porta un nome e una data: finché non c'è un utente, questa pagina resta in sola lettura."
            />
          )}
        </CardBody>
      </Card>

      {coda.length ? (
        <Card>
          <CardHeader
            title="Dopo questo"
            meta={`Altri ${casi.length - indice - 1} casi in coda.`}
          />
          <div>
            {coda.map((altro, posizione) => (
              <Link
                key={altro.id}
                href={`/lifecycle/review?caso=${indice + 2 + posizione}`}
                className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-3 py-2.5 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]"
              >
                {/* Un caso di posizione non ha una scheda, e quindi non ha una
                    foto: il riquadro vuoto prometteva un'immagine che non
                    poteva arrivare. */}
                {altro.property ? (
                  <span className="block h-12 w-16 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]">
                    {foto.get(altro.property.id) ? (
                      <span
                        className="block size-full bg-cover bg-center"
                        style={{
                          backgroundImage: `url("${foto.get(altro.property.id)}")`,
                        }}
                      />
                    ) : null}
                  </span>
                ) : (
                  <MapPin
                    aria-hidden="true"
                    className="size-4 shrink-0 text-[var(--lr-ink-3)]"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                    {altro.property
                      ? nome(altro.property)
                      : altro.reviewType === "GEOGRAPHY"
                        ? formatShouty(
                            proveGeografiche(altro.details).indirizzo ??
                              "Annuncio senza indirizzo",
                          )
                        : "Scheda non più in archivio"}
                  </span>
                  <span className="block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                    {domanda(altro)}
                    {altro.candidates.length
                      ? ` · ${altro.candidates.length} ${altro.candidates.length === 1 ? "candidata" : "candidate"}`
                      : ""}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-[var(--lr-ink-3)]"
                />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

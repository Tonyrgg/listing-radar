import { clsx } from "clsx";
import { ArrowRight, Building2, ScanSearch, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { RecalculateButton } from "@/components/matching/management-panels";
import { PropertyMatchRow } from "@/components/matching/property-match-row";
import { CardFooterLink, RecordCardHeader, RequestFacts } from "@/components/matching/record-card";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { ProgressiveList } from "@/components/progressive-list";
import {
  Campo,
  Card,
  CardBody,
  Chip,
  EmptyState,
  FilterBar,
  Meta,
  Ricerca,
  Scelta,
  buttonClass,
} from "@/components/ui/primitives";
import { formatNumber } from "@/lib/formatting";
import { cleanRequestTitle } from "@/lib/matching/request-presentation";
import {
  getRequestCoverage,
  listMatches,
  listProperties,
  listRequests,
} from "@/lib/matching/repository";
import type {
  RequestPropertyMatch,
} from "@/lib/matching/types";

export const metadata: Metadata = { title: "Chi cerca cosa" };

/**
 * Chi cerca cosa.
 *
 * La prima schermata era il motore che si racconta: «18.796 confronti
 * disponibili», la distribuzione dei punteggi, i pesi di ogni criterio. Roba
 * vera, ma è la manutenzione dell'algoritmo — sta nelle regole automatiche.
 *
 * Qui interessa una cosa sola: chi ha chiesto cosa, e quali case ci vanno
 * vicino. Un cliente per riquadro, le sue case sotto, con le foto.
 */

const QUANTE_PER_RICHIESTA = 4;

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

/**
 * Una porta del quadro commerciale: occhiello, numero e destinazione.
 *
 * L'icona resta silenziosa — l'accento appartiene all'azione della pagina, non
 * a tre riquadri che raccontano soltanto come stanno le cose.
 */
function Porta({
  href,
  icon: Icon,
  label,
  value,
  hint,
  last = false,
}: Readonly<{
  href: string;
  icon: typeof UserRound;
  label: string;
  value: number;
  hint: string;
  last?: boolean;
}>) {
  return (
    <Link
      href={href}
      className={clsx(
        "group flex items-start gap-3 p-4 transition-colors hover:bg-[var(--lr-raised)]",
        !last && "border-b border-[var(--lr-line-quiet)] lg:border-b-0 lg:border-r",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--lr-ink-3)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          {label}
        </span>
        <strong className="mt-2 block font-mono text-[length:var(--lr-text-page)] font-[650] leading-none text-[var(--lr-ink)]">
          {formatNumber(value)}
        </strong>
        <span className="mt-2 block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
          {hint}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="size-4 shrink-0 text-[var(--lr-ink-3)] transition-colors group-hover:text-[var(--lr-ink)]"
      />
    </Link>
  );
}

export default async function ChiCercaCosaPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const query = await searchParams;
  const cerca = param(query.q).trim().toLocaleLowerCase("it");
  const contratto =
    param(query.contratto) === "rent"
      ? "rent"
      : param(query.contratto) === "sale"
        ? "sale"
        : "";
  const modo = param(query.solo);
  const soloBuone = modo === "buone";
  const soloScoperte = modo === "scoperte";

  const [requests, properties, copertura] = await Promise.all([
    listRequests(),
    listProperties(),
    // La copertura serve solo a costruire l'elenco delle richieste scoperte.
    soloScoperte ? getRequestCoverage() : Promise.resolve(null),
  ]);

  const richiesteAttive = requests.filter((request) =>
    ["active", "urgent"].includes(request.status),
  );
  const immobiliLiberi = properties.filter(
    (property) => property.mandate_status === "active",
  );

  const richiestePerContratto = contratto
    ? richiesteAttive.filter((request) => request.contract_type === contratto)
    : richiesteAttive;

  /* Gli abbinamenti si caricano sempre, anche quando la pagina elenca le
   * richieste scoperte: il riquadro in alto li conta, e saltare la query per
   * risparmiarla gli faceva dire «0 abbinamenti utili» — un numero mai
   * calcolato, indistinguibile da un portafoglio che non abbina piu' niente. */
  const matches = await listMatches({
    limit: 600,
    classification: soloBuone ? "compatible" : "",
    minimum: 0,
    requestIds: richiestePerContratto.map((request) => request.id),
  });

  /* Chi non ha nemmeno una casa da vedere. E' la domanda opposta a quella
   * abituale: non «cosa propongo a questo cliente», ma «per chi non ho niente»,
   * cioe' da dove far partire la ricerca di nuovi immobili. Il conteggio arriva
   * dal database perche' qui una risposta approssimata varrebbe meno di nessuna
   * risposta: manderebbe a cercare case per clienti gia' serviti. */
  /* Le richieste ordinate dalla piu' povera alla piu' servita.
   *
   * Le completamente scoperte sono quattro, e quattro nomi non bastano a
   * decidere cosa cercare: fra chi non ha niente e chi e' servito ci sono i
   * clienti con una casa sola, scoperti quasi quanto gli altri. A parita' di
   * case proponibili viene prima chi ha il punteggio migliore piu' basso: e' la
   * richiesta da cui il portafoglio e' piu' lontano. */
  const perCopertura = soloScoperte && copertura
    ? richiestePerContratto
      .map((request) => ({
        request,
        coperta: copertura.get(request.id) ?? {
          bestScore: 0, excellentCount: 0, proposableCount: 0, nearCount: 0,
        },
      }))
      .sort((a, b) =>
        a.coperta.proposableCount - b.coperta.proposableCount
        || a.coperta.bestScore - b.coperta.bestScore)
    : [];
  const senzaNiente = perCopertura.filter(({ coperta }) => !coperta.proposableCount).length;
  const conteggioNonRiuscito = soloScoperte && !copertura;

  const richiestaPerId = new Map(
    richiestePerContratto.map((item) => [item.id, item]),
  );
  const immobilePerId = new Map(immobiliLiberi.map((item) => [item.id, item]));

  const gruppi = new Map<string, RequestPropertyMatch[]>();
  for (const match of matches) {
    if (
      !richiestaPerId.has(match.request_id) ||
      !immobilePerId.has(match.property_id)
    )
      continue;
    gruppi.set(match.request_id, [
      ...(gruppi.get(match.request_id) ?? []),
      match,
    ]);
  }

  const ordinati = [...gruppi.entries()].sort(
    (a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0),
  );

  const filtrati = ordinati.filter(([requestId, gruppo]) => {
    if (!cerca) return true;
    const request = richiestaPerId.get(requestId);
    const propertiesText = gruppo
      .map((match) => {
        const property = immobilePerId.get(match.property_id);
        return [property?.title, property?.address, property?.zone?.name]
          .filter(Boolean)
          .join(" ");
      })
      .join(" ");
    return [
      request?.clients?.full_name,
      request?.title,
      request?.municipality,
      propertiesText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("it")
      .includes(cerca);
  });

  const scoperteFiltrate = perCopertura.filter(({ request }) => {
    if (!cerca) return true;
    return [request.clients?.full_name, request.title, request.municipality]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("it")
      .includes(cerca);
  });

  const sePuoCalcolare =
    richiesteAttive.length > 0 && immobiliLiberi.length > 0;

  return (
    <div className="space-y-5">
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Chi cerca cosa"
        description="Ogni cliente con una richiesta aperta, e le case del portafoglio che ci vanno vicino. Chi decide sei tu: la lista mette in fila, non sceglie."
        actions={
          <div className="flex flex-wrap gap-2">
            <QuickRequestButton />
            {sePuoCalcolare ? <RecalculateButton scope="all" /> : null}
          </div>
        }
      />

      {/* Tre porte, e dietro ognuna un numero verificabile. Non sono
        * statistiche decorative: ogni riquadro porta a una pagina che esiste. */}
      <section
        className="grid overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] lg:grid-cols-3"
        aria-label="Quadro commerciale"
      >
        <Porta
          href="/requests"
          icon={UserRound}
          label="Richieste attive"
          value={richiesteAttive.length}
          hint="Clienti con una ricerca aperta"
        />
        <Porta
          href="/matching/overview"
          icon={ScanSearch}
          label="Abbinamenti utili"
          value={matches.length}
          hint="Confronti già calcolati"
        />
        <Porta
          href="/portfolio"
          icon={Building2}
          label="Immobili disponibili"
          value={immobiliLiberi.length}
          hint="Portafoglio da proporre"
          last
        />
      </section>

      <AutoSubmitFiltersForm>
        <FilterBar
          summary={soloScoperte
            ? `${formatNumber(senzaNiente)} clienti senza nemmeno una casa, poi i meno serviti`
            : `${formatNumber(filtrati.length)} clienti con abbinamenti`}
          active={Boolean(cerca || contratto || modo)}
          resetHref="/matching"
        >
        <Ricerca
          label="Cerca in abbinamenti"
          defaultValue={param(query.q)}
          placeholder="cliente, casa, via, zona…"
        />
        <Campo label="Vendita o affitto" labelHidden className="min-w-48">
          <Scelta name="contratto" defaultValue={contratto}>
            <option value="">Chi compra e chi affitta</option>
            <option value="sale">Solo chi compra</option>
            <option value="rent">Solo chi affitta</option>
          </Scelta>
        </Campo>

        <Campo label="Quali case mostrare" labelHidden className="min-w-56">
          <Scelta name="solo" defaultValue={modo}>
            <option value="">Tutte le case che ci vanno vicino</option>
            <option value="buone">Solo quelle che vanno bene</option>
            <option value="scoperte">Richieste meno coperte</option>
          </Scelta>
        </Campo>

        <Meta>
          {richiestePerContratto.length} clienti in cerca ·{" "}
          {immobiliLiberi.length} case in portafoglio
        </Meta>
        </FilterBar>
      </AutoSubmitFiltersForm>

      {soloScoperte ? (
        conteggioNonRiuscito ? (
          <Card>
            <CardBody>
              <EmptyState
                title="Non riesco a contare gli abbinamenti"
                description="Senza il conteggio non posso dire quali richieste siano scoperte, e un elenco incompleto qui manderebbe a cercare case per clienti già serviti. Riprova, oppure controlla che la migrazione del conteggio sia stata applicata."
              />
            </CardBody>
          </Card>
        ) : scoperteFiltrate.length ? (
          <ProgressiveList className="space-y-5" initialCount={8} step={8} noun="clienti">
            {scoperteFiltrate.map(({ request, coperta }) => {
              const cliente = request.clients?.full_name ?? "Cliente da collegare";
              const migliore = Math.round(coperta.bestScore);
              const proponibili = coperta.proposableCount;
              return (
                <Card key={request.id}>
                  <RecordCardHeader
                    icon={UserRound}
                    title={cliente}
                    factsLabel="Criteri della richiesta"
                    facts={<RequestFacts request={request} />}
                    subtitle={request.title ? cleanRequestTitle(request.title) : null}
                    chips={
                      <Chip tone={proponibili ? "warn" : "danger"}>
                        {proponibili
                          ? `${proponibili} ${proponibili === 1 ? "casa" : "case"} da proporre`
                          : "Nessuna casa"}
                      </Chip>
                    }
                    action={
                      <Link
                        href={`/requests/${request.id}`}
                        className={buttonClass("quiet", { compact: true })}
                      >
                        La richiesta
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    }
                  />
                  <CardBody>
                    <Meta>
                      {proponibili === 0
                        ? (migliore > 0
                          ? `Nessuna delle ${immobiliLiberi.length} case in portafoglio arriva a una proposta: la più vicina si ferma al ${migliore}%. È una casa da cercare, non un abbinamento da migliorare.`
                          : `Nessuna delle ${immobiliLiberi.length} case in portafoglio è compatibile con questi criteri.`)
                        : `${proponibili === 1 ? "Una sola casa" : `Solo ${proponibili} case`} su ${immobiliLiberi.length} da proporre: se il cliente dice di no, non resta molto.`}
                      {coperta.excellentCount > 0
                        ? ` ${coperta.excellentCount} ${coperta.excellentCount === 1 ? "arriva" : "arrivano"} al 90%.`
                        : ""}
                      {coperta.nearCount > 0
                        ? ` Altre ${coperta.nearCount} si fermano poco sotto la soglia: forse basta rivedere i criteri.`
                        : ""}
                    </Meta>
                  </CardBody>
                </Card>
              );
            })}
          </ProgressiveList>
        ) : (
          <Card>
            <CardBody>
              <EmptyState
                title="Nessuna richiesta da mostrare"
                description="Con questi filtri non resta nessun cliente in elenco."
                action={
                  <Link href="/matching" className={buttonClass("secondary", { compact: true })}>
                    Torna agli abbinamenti
                  </Link>
                }
              />
            </CardBody>
          </Card>
        )
      ) : filtrati.length ? (
        <ProgressiveList
          className="space-y-5"
          initialCount={6}
          step={6}
          noun="clienti"
        >
          {filtrati.map(([requestId, gruppo]) => {
            const request = richiestaPerId.get(requestId);
            if (!request) return null;

            const cliente =
              request.clients?.full_name ?? "Cliente da collegare";
            return (
              <Card key={requestId}>
                <RecordCardHeader
                  icon={UserRound}
                  title={cliente}
                  factsLabel="Criteri della richiesta"
                  facts={<RequestFacts request={request} />}
                  subtitle={request.title ? cleanRequestTitle(request.title) : null}
                  chips={
                    <Chip tone="neutral">
                      {gruppo.length} {gruppo.length === 1 ? "casa" : "case"}
                    </Chip>
                  }
                  action={
                    <Link
                      href={`/requests/${request.id}`}
                      className={buttonClass("quiet", { compact: true })}
                    >
                      La richiesta
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  }
                />

                <div>
                  {gruppo.slice(0, QUANTE_PER_RICHIESTA).map((match) => {
                    const property = immobilePerId.get(match.property_id);
                    if (!property) return null;

                    return (
                      <PropertyMatchRow
                        key={
                          match.id ?? `${match.request_id}-${match.property_id}`
                        }
                        match={match}
                        property={property}
                      />
                    );
                  })}
                </div>

                {gruppo.length > QUANTE_PER_RICHIESTA ? (
                  <CardFooterLink href={`/requests/${request.id}`}>
                    Altre {gruppo.length - QUANTE_PER_RICHIESTA} case ci vanno
                    vicino: si vedono tutte nella richiesta di {cliente}.
                  </CardFooterLink>
                ) : null}
              </Card>
            );
          })}
        </ProgressiveList>
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title={
                sePuoCalcolare
                  ? "Nessun cliente con case da vedere"
                  : "Servono un cliente e una casa"
              }
              description={
                sePuoCalcolare
                  ? "Con questi filtri non resta niente. Prova ad allargare, oppure rifai il calcolo dal pulsante in alto."
                  : "Gli abbinamenti nascono da almeno una richiesta aperta e una casa libera in portafoglio."
              }
              action={
                <Link
                  href="/matching"
                  className={buttonClass("secondary", { compact: true })}
                >
                  Mostra tutti
                </Link>
              }
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

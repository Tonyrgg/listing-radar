import { clsx } from "clsx";
import { ArrowRight, Banknote, Building2, Layers3, MapPin, Ruler, ScanSearch, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { RecalculateButton } from "@/components/matching/management-panels";
import { PropertyMatchRow } from "@/components/matching/property-match-row";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { PropertyTypeMark } from "@/components/matching/visual-language";
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
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { cleanRequestTitle } from "@/lib/matching/request-presentation";
import {
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

/** Cosa cerca un cliente, in una riga che si legge. */
function RequestFact({
  icon: Icon,
  label,
  children,
}: Readonly<{
  icon: typeof Banknote;
  label: string;
  children: ReactNode;
}>) {
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
  const soloBuone = param(query.solo) === "buone";

  const [requests, properties] = await Promise.all([
    listRequests(),
    listProperties(),
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

  const matches = await listMatches({
    limit: 600,
    classification: soloBuone ? "compatible" : "",
    minimum: 0,
    requestIds: richiestePerContratto.map((request) => request.id),
  });

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
          summary={`${formatNumber(filtrati.length)} clienti con abbinamenti`}
          active={Boolean(cerca || contratto || soloBuone)}
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
          <Scelta name="solo" defaultValue={soloBuone ? "buone" : ""}>
            <option value="">Tutte le case che ci vanno vicino</option>
            <option value="buone">Solo quelle che vanno bene</option>
          </Scelta>
        </Campo>

        <Meta>
          {richiestePerContratto.length} clienti in cerca ·{" "}
          {immobiliLiberi.length} case in portafoglio
        </Meta>
        </FilterBar>
      </AutoSubmitFiltersForm>

      {filtrati.length ? (
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
            const budget = request.contract_type === "sale"
              ? (request.budget_max ?? request.budget_ideal)
              : (request.monthly_rent_max ?? request.monthly_rent_ideal);
            const superficie = request.internal_sqm_ideal ?? request.internal_sqm_min;
            const locali = request.rooms_ideal ?? request.rooms_min;
            const zone = [...new Set(
              (request.request_zones ?? [])
                .filter((item) => item.preference_level !== "excluded")
                .map((item) => item.zone?.name)
                .filter((name): name is string => Boolean(name)),
            )];
            const posizione = zone.join(" · ") || request.municipality;

            return (
              <Card key={requestId}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--lr-line-quiet)] px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[length:var(--lr-text-record)] font-[650] leading-tight text-[var(--lr-ink)]">
                      <UserRound
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                      {cliente}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Criteri della richiesta">
                      {request.property_types?.map((type) => (
                        <PropertyTypeMark key={type} type={type} />
                      ))}
                      {budget != null ? (
                        <RequestFact icon={Banknote} label="Budget">
                          {request.contract_type === "sale" ? `fino a ${formatCurrency(budget)}` : `fino a ${formatCurrency(budget)} al mese`}
                        </RequestFact>
                      ) : null}
                      {superficie != null ? (
                        <RequestFact icon={Ruler} label="Superficie">
                          {formatNumber(superficie)} mq
                        </RequestFact>
                      ) : null}
                      {locali != null ? (
                        <RequestFact icon={Layers3} label="Locali">
                          {formatNumber(locali)} locali
                        </RequestFact>
                      ) : null}
                      {posizione ? (
                        <RequestFact icon={MapPin} label="Zone richieste">
                          {posizione}
                        </RequestFact>
                      ) : null}
                    </div>
                    {request.title ? (
                      <p className="mt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                        {cleanRequestTitle(request.title)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Chip tone="neutral">
                      {gruppo.length} {gruppo.length === 1 ? "casa" : "case"}
                    </Chip>
                    <Link
                      href={`/requests/${request.id}`}
                      className={buttonClass("quiet", { compact: true })}
                    >
                      La richiesta
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  </div>
                </div>

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
                  <Link
                    href={`/requests/${request.id}`}
                    className="block border-t border-[var(--lr-line-quiet)] px-4 py-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]"
                  >
                    Altre {gruppo.length - QUANTE_PER_RICHIESTA} case ci vanno
                    vicino: si vedono tutte nella richiesta di {cliente}.
                  </Link>
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

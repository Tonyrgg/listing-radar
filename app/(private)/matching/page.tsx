import { ArrowRight, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { RecalculateButton } from "@/components/matching/management-panels";
import { PropertyMatchRow } from "@/components/matching/property-match-row";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { ProgressiveList } from "@/components/progressive-list";
import {
  Campo,
  Card,
  CardBody,
  Chip,
  EmptyState,
  Meta,
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
  PropertyRequest,
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
function cosaCerca(request: PropertyRequest) {
  const pezzi: string[] = [];

  if (request.property_types?.length) {
    pezzi.push(request.property_types.join(" o "));
  }

  const budget =
    request.contract_type === "sale"
      ? (request.budget_max ?? request.budget_ideal)
      : (request.monthly_rent_max ?? request.monthly_rent_ideal);
  if (budget != null) {
    pezzi.push(
      request.contract_type === "sale"
        ? `fino a ${formatCurrency(budget)}`
        : `fino a ${formatCurrency(budget)} al mese`,
    );
  }

  const superficie = request.internal_sqm_ideal ?? request.internal_sqm_min;
  if (superficie != null)
    pezzi.push(`intorno ai ${formatNumber(superficie)} mq`);

  const locali = request.rooms_ideal ?? request.rooms_min;
  if (locali != null) pezzi.push(`${formatNumber(locali)} locali`);

  if (request.municipality) pezzi.push(`a ${request.municipality}`);

  return pezzi.join(" · ") || "Nessun criterio indicato";
}

export default async function ChiCercaCosaPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const query = await searchParams;
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

      <AutoSubmitFiltersForm className="flex flex-wrap items-center gap-2">
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
      </AutoSubmitFiltersForm>

      {ordinati.length ? (
        <ProgressiveList
          className="space-y-5"
          initialCount={6}
          step={6}
          noun="clienti"
        >
          {ordinati.map(([requestId, gruppo]) => {
            const request = richiestaPerId.get(requestId);
            if (!request) return null;

            const cliente =
              request.clients?.full_name ?? "Cliente da collegare";

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
                    <p className="mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      Cerca {cosaCerca(request)}
                    </p>
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

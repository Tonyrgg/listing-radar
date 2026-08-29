import {
  ArrowLeft,
  ArrowRight,
  Flame,
  UserRound,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { LoadingAnchor } from "@/components/loading-controls";
import { QuickRequestButton } from "@/components/matching/quick-request";
import {
  RecordCardHeader,
  RequestFacts,
  cardFooterLinkClass,
} from "@/components/matching/record-card";
import { MatchingSectionHeader } from "@/components/matching/section-header";
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
import {
  cleanRequestTitle,
  crmField,
  formatDate,
  requestActivityCount,
  requestPayload,
  requestSearchText,
  requestSourceLabel,
} from "@/lib/matching/request-presentation";
import {
  listCompatibleMatchReferences,
  listRequests,
} from "@/lib/matching/repository";
import type { PropertyRequest } from "@/lib/matching/types";

/** La richiesta come arriva dal database, con il cliente e le zone collegate. */
type RichiestaCompleta = Awaited<ReturnType<typeof listRequests>>[number];

export const metadata: Metadata = { title: "Chi ci ha chiesto una casa" };

/**
 * Le richieste dei clienti.
 *
 * Ogni scheda era una tabella di dodici righe etichetta-valore, e metà di
 * quelle righe diceva «Non indicata», «Nessuna preferenza di zona», «Qualsiasi».
 * Dodici righe per scoprire che di quel cliente si sa poco.
 *
 * Adesso una richiesta è una persona e una frase: cosa cerca, con quali soldi,
 * dove. Quello che manca non occupa spazio. E la frase che il cliente ha detto
 * davvero — l'esigenza scritta a mano — sta in evidenza, perché è l'unica
 * riga che nessun campo strutturato sa sostituire.
 */

const PER_PAGINA = 24;

const STATI: Record<string, string> = {
  draft: "Bozza",
  active: "Aperta",
  urgent: "Urgente",
  suspended: "Sospesa",
  satisfied: "Chiusa: trovata",
  cancelled: "Annullata",
  archived: "Archiviata",
};

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

/**
 * La tipologia come l'ha scritta l'agente nel gestionale.
 *
 * Il campo strutturato è quasi sempre vuoto, e quando c'è dice «villa» dove il
 * cliente ha detto «villa singola». Se la riga scritta a mano esiste vince
 * lei: è l'unica che porta la sfumatura.
 */
function sottotipologia(request: RichiestaCompleta) {
  const dalGestionale = crmField(
    requestPayload(request),
    "Sottotipologia Immobile",
  );
  const scritta = typeof dalGestionale === "string" ? dalGestionale.trim() : "";

  return scritta || null;
}

/** La frase che il cliente ha detto: vale più di ogni campo. */
function parolePronunciate(request: PropertyRequest) {
  const payload = requestPayload(request);
  const esigenza = crmField(payload, "Esigenze");
  const testo = typeof esigenza === "string" ? esigenza.trim() : "";

  return testo || request.notes?.trim() || null;
}

export default async function RichiesteClientiPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const query = await searchParams;
  const cerca = param(query.q).trim().toLocaleLowerCase("it");
  const stato = param(query.stato);
  const contratto = param(query.contratto);
  const zona = param(query.zona);

  const [requests, matches] = await Promise.all([
    listRequests(),
    listCompatibleMatchReferences(),
  ]);

  const quanteCase = new Map<string, number>();
  for (const match of matches) {
    if (match.classification !== "compatible") continue;
    quanteCase.set(
      match.request_id,
      (quanteCase.get(match.request_id) ?? 0) + 1,
    );
  }

  const zoneDisponibili = [...new Set(
    requests.flatMap((request) =>
      (request.request_zones ?? [])
        .filter((item) => item.preference_level !== "excluded")
        .map((item) => item.zone?.name)
        .filter((nome): nome is string => Boolean(nome)),
    ),
  )].sort((a, b) => a.localeCompare(b, "it"));

  const filtrate = requests.filter((request) => {
    const zoneRichieste = (request.request_zones ?? [])
      .filter((item) => item.preference_level !== "excluded")
      .map((item) => item.zone?.name)
      .filter((nome): nome is string => Boolean(nome));

    return (
      (!cerca || requestSearchText(request).includes(cerca)) &&
      (!stato || request.status === stato) &&
      (!contratto || request.contract_type === contratto) &&
      (!zona || zoneRichieste.includes(zona))
    );
  });

  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA));
  const chiesta = Number.parseInt(param(query.pagina) || "1", 10);
  const pagina = Math.min(
    Math.max(Number.isFinite(chiesta) ? chiesta : 1, 1),
    pagine,
  );
  const visibili = filtrate.slice(
    (pagina - 1) * PER_PAGINA,
    pagina * PER_PAGINA,
  );

  const filtriAttivi = Boolean(cerca || stato || contratto || zona);
  const persistenti = { q: param(query.q), stato, contratto, zona };

  return (
    <div className="space-y-5">
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Chi ci ha chiesto una casa"
        description="Parti da chi è pronto a muoversi, poi apri il dettaglio o il CRM quando serve."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral">
              {filtrate.length === requests.length
                ? `${formatNumber(requests.length)} richieste`
                : `${formatNumber(filtrate.length)} di ${formatNumber(requests.length)}`}
            </Chip>
            <QuickRequestButton />
          </div>
        }
      />

      <AutoSubmitFiltersForm>
        <FilterBar summary={`${formatNumber(filtrate.length)} clienti nel risultato`}>
        <Ricerca
          label="Cerca fra le richieste"
          defaultValue={param(query.q)}
          placeholder="nome del cliente, zona, tipologia…"
        />

        <Campo label="Stato della richiesta" labelHidden className="min-w-44">
          <Scelta name="stato" defaultValue={stato}>
            <option value="">In qualsiasi stato</option>
            <option value="active">Aperte</option>
            <option value="urgent">Urgenti</option>
            <option value="satisfied">Già chiuse</option>
            <option value="suspended">Sospese</option>
          </Scelta>
        </Campo>

        <Campo label="Compra o affitta" labelHidden className="min-w-44">
          <Scelta name="contratto" defaultValue={contratto}>
            <option value="">Chi compra e chi affitta</option>
            <option value="sale">Chi compra</option>
            <option value="rent">Chi affitta</option>
          </Scelta>
        </Campo>

        <Campo label="Zona cercata" labelHidden className="min-w-40">
          <Scelta name="zona" defaultValue={zona}>
            <option value="">Tutte le zone</option>
            {zoneDisponibili.map((nome) => (
              <option value={nome} key={nome}>{nome}</option>
            ))}
          </Scelta>
        </Campo>

        {filtriAttivi ? (
          <Link
            href="/requests"
            className={buttonClass("quiet", { compact: true })}
          >
            <X aria-hidden="true" className="size-4" />
            Azzera
          </Link>
        ) : null}
        </FilterBar>
      </AutoSubmitFiltersForm>

      {visibili.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          {visibili.map((request) => {
            const payload = requestPayload(request);
            const calda =
              crmField(payload, "Richiesta Calda") === true ||
              request.priority === "urgent";
            const case_ = quanteCase.get(request.id) ?? 0;
            const parole = parolePronunciate(request);
            const cliente =
              request.clients?.full_name || "Cliente da collegare";

            return (
              <Card key={request.id}>
                <RecordCardHeader
                  icon={UserRound}
                  title={
                    <Link
                      href={`/requests/${request.id}`}
                      className="truncate transition-colors hover:text-[var(--lr-accent)]"
                    >
                      {cliente}
                    </Link>
                  }
                  factsLabel="Criteri della richiesta"
                  facts={
                    <RequestFacts
                      request={request}
                      subtype={sottotipologia(request)}
                    />
                  }
                  subtitle={
                    request.title ? cleanRequestTitle(request.title) : null
                  }
                  chips={
                    <>
                      {calda ? (
                        <Chip tone="warn">
                          <Flame aria-hidden="true" className="size-3" />
                          Calda
                        </Chip>
                      ) : null}
                      {case_ ? (
                        <Chip tone="neutral">
                          {formatNumber(case_)}{" "}
                          {case_ === 1 ? "casa" : "case"}
                        </Chip>
                      ) : null}
                      <Meta>{STATI[request.status] ?? request.status}</Meta>
                    </>
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

                <CardBody className="space-y-2">
                  {/* Le parole del cliente, quando ci sono, valgono più di ogni campo. */}
                  {parole ? (
                    <p className="border-l-2 border-[var(--lr-line)] pl-3 text-[length:var(--lr-text-body)] italic text-[var(--lr-ink-2)]">
                      «{parole}»
                    </p>
                  ) : null}

                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                    <span>{formatDate(request.created_at)}</span>
                    <span>{requestSourceLabel(request)}</span>
                    {requestActivityCount(request) ? (
                      <span>{requestActivityCount(request)} contatti</span>
                    ) : null}
                    {case_ ? null : (
                      <span>nessuna casa in portafoglio le somiglia</span>
                    )}
                  </p>
                </CardBody>

                {payload.url ? (
                  <LoadingAnchor
                    href={payload.url}
                    target="_blank"
                    rel="noreferrer"
                    pendingLabel="Apro CRM"
                    className={cardFooterLinkClass}
                  >
                    Apri la scheda nel gestionale ↗
                  </LoadingAnchor>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-4">
          <EmptyState
            title="Nessuna richiesta con questi filtri"
            description="Prova ad allargare la ricerca: potrebbe esserci un cliente escluso da un filtro attivo."
            action={
              <Link
                href="/requests"
                className={buttonClass("primary", { compact: true })}
              >
                Mostra tutte
              </Link>
            }
          />
        </Card>
      )}

      {pagine > 1 ? (
        <nav
          className="flex flex-wrap items-center gap-2"
          aria-label="Altre pagine di richieste"
        >
          <Link
            href={href(persistenti, pagina - 1)}
            aria-disabled={pagina === 1 || undefined}
            tabIndex={pagina === 1 ? -1 : undefined}
            className={buttonClass("quiet", { compact: true })}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Indietro
          </Link>
          <Meta>
            pagina {pagina} di {pagine}
          </Meta>
          <Link
            href={href(persistenti, pagina + 1)}
            aria-disabled={pagina === pagine || undefined}
            tabIndex={pagina === pagine ? -1 : undefined}
            className={buttonClass("quiet", { compact: true })}
          >
            Avanti
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

function href(params: Record<string, string>, pagina: number) {
  const search = new URLSearchParams();
  for (const [chiave, valore] of Object.entries(params))
    if (valore) search.set(chiave, valore);
  if (pagina > 1) search.set("pagina", String(pagina));
  const stringa = search.toString();

  return stringa ? `/requests?${stringa}` : "/requests";
}

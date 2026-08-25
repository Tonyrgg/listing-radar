import { ArrowLeft, ArrowRight, ArrowUpRight, Flame, Search, UserRound, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { Card, Chip, EmptyState, Meta, Stripe, buttonClass } from "@/components/ui/primitives";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import {
  cleanRequestTitle,
  crmField,
  formatDate,
  requestActivityCount,
  requestPayload,
  requestSearchText,
  requestSourceLabel,
} from "@/lib/matching/request-presentation";
import { listCompatibleMatchReferences, listRequests } from "@/lib/matching/repository";
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

const TIPI: Record<string, string> = {
  apartment: "un appartamento",
  independent_house: "una casa indipendente",
  villa: "una villa",
  townhouse: "una villetta",
  penthouse: "un attico",
  ground_floor: "un piano terra",
  entire_building: "un intero stabile",
};

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

/** Cosa cerca il cliente, in una frase invece che in dodici righe. */
function cosaCerca(request: RichiestaCompleta) {
  /* Il campo strutturato è quasi sempre vuoto: la tipologia vera sta nella
   * scheda del gestionale, ed è quella che il cliente ha detto. */
  const dalGestionale = crmField(requestPayload(request), "Sottotipologia Immobile");
  const scritta = typeof dalGestionale === "string" ? dalGestionale.trim() : "";

  const cosa = scritta
    ? scritta.toLocaleLowerCase("it")
    : request.property_types?.length
      ? request.property_types.map((tipo) => TIPI[tipo] ?? tipo).join(" o ")
      : "una casa";

  const pezzi: string[] = [];

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
  if (superficie != null) pezzi.push(`intorno ai ${formatNumber(superficie)} mq`);

  const locali = request.rooms_ideal ?? request.rooms_min;
  if (locali != null) pezzi.push(`${formatNumber(locali)} locali`);

  const zone = (request.request_zones ?? [])
    .filter((item) => item.preference_level !== "excluded")
    .map((item) => item.zone?.name)
    .filter((nome): nome is string => Boolean(nome));
  if (zone.length) pezzi.push(`in ${zone.join(", ")}`);
  else if (request.municipality) pezzi.push(`a ${request.municipality}`);

  return `Cerca ${cosa}${pezzi.length ? `, ${pezzi.join(", ")}` : ""}.`;
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
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const cerca = param(query.q).trim().toLocaleLowerCase("it");
  const stato = param(query.stato);
  const contratto = param(query.contratto);

  const [requests, matches] = await Promise.all([
    listRequests(),
    listCompatibleMatchReferences(),
  ]);

  const quanteCase = new Map<string, number>();
  for (const match of matches) {
    if (match.classification !== "compatible") continue;
    quanteCase.set(match.request_id, (quanteCase.get(match.request_id) ?? 0) + 1);
  }

  const filtrate = requests.filter(
    (request) =>
      (!cerca || requestSearchText(request).includes(cerca)) &&
      (!stato || request.status === stato) &&
      (!contratto || request.contract_type === contratto),
  );

  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA));
  const chiesta = Number.parseInt(param(query.pagina) || "1", 10);
  const pagina = Math.min(Math.max(Number.isFinite(chiesta) ? chiesta : 1, 1), pagine);
  const visibili = filtrate.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA);

  const filtriAttivi = Boolean(cerca || stato || contratto);
  const persistenti = { q: param(query.q), stato, contratto };

  return (
    <div className="space-y-5">
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Chi ci ha chiesto una casa"
        description="Ogni cliente con quello che sta cercando, detto come lo direbbe lui. Le richieste arrivano dal gestionale e restano aggiornate."
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

      <AutoSubmitFiltersForm className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lr-ink-3)]"
          />
          <span className="sr-only">Cerca fra le richieste</span>
          <input
            type="search"
            name="q"
            defaultValue={param(query.q)}
            placeholder="nome del cliente, zona, tipologia…"
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] pl-9 pr-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          />
        </label>

        <label className="min-w-44">
          <span className="sr-only">Stato della richiesta</span>
          <select
            name="stato"
            defaultValue={stato}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">In qualsiasi stato</option>
            <option value="active">Aperte</option>
            <option value="urgent">Urgenti</option>
            <option value="satisfied">Già chiuse</option>
            <option value="suspended">Sospese</option>
          </select>
        </label>

        <label className="min-w-44">
          <span className="sr-only">Compra o affitta</span>
          <select
            name="contratto"
            defaultValue={contratto}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">Chi compra e chi affitta</option>
            <option value="sale">Chi compra</option>
            <option value="rent">Chi affitta</option>
          </select>
        </label>

        {filtriAttivi ? (
          <Link href="/requests" className={buttonClass("quiet", { compact: true })}>
            <X aria-hidden="true" className="size-4" />
            Azzera
          </Link>
        ) : null}
      </AutoSubmitFiltersForm>

      {visibili.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibili.map((request) => {
            const payload = requestPayload(request);
            const calda =
              crmField(payload, "Richiesta Calda") === true || request.priority === "urgent";
            const case_ = quanteCase.get(request.id) ?? 0;
            const parole = parolePronunciate(request);
            const cliente = request.clients?.full_name || "Cliente da collegare";

            return (
              <Card key={request.id} className="flex gap-3 p-4">
                <Stripe tone={calda ? "warn" : "neutral"} />

                <Link href={`/requests/${request.id}`} className="group min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <p className="flex min-w-0 items-center gap-2 text-[length:var(--lr-text-record)] font-[650] leading-tight text-[var(--lr-ink)]">
                      <UserRound aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{cliente}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-2">
                      {calda ? (
                        <Chip tone="warn">
                          <Flame aria-hidden="true" className="size-3" />
                          Calda
                        </Chip>
                      ) : null}
                      <Meta>{STATI[request.status] ?? request.status}</Meta>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 text-[var(--lr-ink-3)] transition-colors group-hover:text-[var(--lr-ink)]"
                      />
                    </span>
                  </div>

                  <p className="mt-2 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                    {cosaCerca(request)}
                  </p>

                  {/* Le parole del cliente, quando ci sono, valgono più di ogni campo. */}
                  {parole ? (
                    <p className="mt-2 border-l-2 border-[var(--lr-line)] pl-3 text-[length:var(--lr-text-body)] italic text-[var(--lr-ink-2)]">
                      «{parole}»
                    </p>
                  ) : null}

                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                    <span className={case_ ? "text-[var(--lr-accent)]" : undefined}>
                      {case_
                        ? `${formatNumber(case_)} ${case_ === 1 ? "casa che può andare" : "case che possono andare"}`
                        : "nessuna casa in portafoglio le somiglia"}
                    </span>
                    <span>{formatDate(request.created_at)}</span>
                    <span>{requestSourceLabel(request)}</span>
                    {requestActivityCount(request) ? (
                      <span>{requestActivityCount(request)} contatti</span>
                    ) : null}
                    {request.title ? (
                      <span className="truncate">{cleanRequestTitle(request.title)}</span>
                    ) : null}
                  </p>
                </Link>
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
              <Link href="/requests" className={buttonClass("primary", { compact: true })}>
                Mostra tutte
              </Link>
            }
          />
        </Card>
      )}

      {pagine > 1 ? (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Altre pagine di richieste">
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
  for (const [chiave, valore] of Object.entries(params)) if (valore) search.set(chiave, valore);
  if (pagina > 1) search.set("pagina", String(pagina));
  const stringa = search.toString();

  return stringa ? `/requests?${stringa}` : "/requests";
}

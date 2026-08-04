import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Flame,
  History,
  Search,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import {
  cleanRequestTitle,
  crmField,
  displayValue,
  formatDate,
  requestActivityCount,
  requestArea,
  requestBudget,
  requestPayload,
  requestReference,
  requestRooms,
  requestSearchText,
  requestSourceLabel,
} from "@/lib/matching/request-presentation";
import { listCompatibleMatchReferences, listRequests } from "@/lib/matching/repository";

import styles from "./requests.module.css";

const PAGE_SIZE = 24;

export default async function RequestsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = await searchParams;
  const [requests, matches] = await Promise.all([listRequests(), listCompatibleMatchReferences()]);
  const query = value(params.q);
  const status = value(params.status);
  const contract = value(params.contract);
  const priority = value(params.priority);
  const client = value(params.client);
  const destination = value(params.destination);
  const normalizedQuery = query.trim().toLocaleLowerCase("it");

  const filteredRequests = requests.filter((request) =>
    (!normalizedQuery || requestSearchText(request).includes(normalizedQuery)) &&
    (!status || request.status === status) &&
    (!contract || request.contract_type === contract) &&
    (!priority || request.priority === priority) &&
    (!destination || request.destination === destination) &&
    (!client || (client === "anonymous" ? !request.client_id : Boolean(request.client_id))),
  );

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(value(params.page) || "1", 10);
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const pageRequests = filteredRequests.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const compatibleCounts = new Map<string, number>();
  for (const match of matches) {
    if (match.classification !== "compatible") continue;
    compatibleCounts.set(match.request_id, (compatibleCounts.get(match.request_id) ?? 0) + 1);
  }

  const activeFilters = [status, contract, priority, client, destination].filter(Boolean).length;
  const persistentParams = { q: query, status, contract, priority, client, destination };

  return (
    <div className={styles.page}>
      <header className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>Clienti e immobili</p>
          <h1 className={styles.pageTitle}>Richieste immobiliari</h1>
          <p className={styles.pageDescription}>
            L’archivio operativo delle esigenze cliente, con i dati importati dal CRM e i match disponibili.
          </p>
        </div>
        <QuickRequestButton />
      </header>

      <MatchingSectionNav />

      <form className={styles.toolbar}>
        <div className={styles.searchRow}>
          <label className={styles.searchControl}>
            <span className="sr-only">Cerca nelle richieste</span>
            <Search aria-hidden="true" />
            <input
              className={styles.input}
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Cerca cliente, riferimento, tipologia o esigenza…"
            />
          </label>
          <button className={styles.button}>Cerca</button>
        </div>
        <details className={styles.filterPanel} open={activeFilters > 0}>
          <summary className={styles.filterSummary}>
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filtri avanzati{activeFilters ? ` · ${activeFilters} attivi` : ""}
          </summary>
          <div className={styles.filterGrid}>
            <Filter name="status" label="Tutti gli stati" value={status} options={[
              ["draft", "Bozza"], ["active", "Attiva"], ["urgent", "Urgente"],
              ["suspended", "Sospesa"], ["satisfied", "Soddisfatta"], ["archived", "Archiviata"],
            ]} />
            <Filter name="contract" label="Acquisto e locazione" value={contract} options={[
              ["sale", "Acquisto"], ["rent", "Locazione"],
            ]} />
            <Filter name="priority" label="Tutte le priorità" value={priority} options={[
              ["low", "Senza fretta"], ["normal", "Normale"], ["high", "Importante"], ["urgent", "Urgente"],
            ]} />
            <Filter name="destination" label="Tutte le finalità" value={destination} options={[
              ["first_home", "Prima casa"], ["investment", "Investimento"], ["exchange", "Permuta"],
              ["temporary", "Esigenza temporanea"], ["other", "Altro"],
            ]} />
            <Filter name="client" label="Tutti i clienti" value={client} options={[
              ["anonymous", "Senza cliente"], ["linked", "Con cliente"],
            ]} />
            <button className={styles.button}>Applica filtri</button>
            {activeFilters || query ? (
              <Link className={styles.secondaryButton} href="/requests">Azzera</Link>
            ) : null}
          </div>
        </details>
      </form>

      <div className={styles.listSummary}>
        <p className={styles.resultCount} aria-live="polite">
          <strong>{filteredRequests.length}</strong> richieste · pagina {currentPage} di {totalPages}
        </p>
        <p className={styles.resultCount}>24 schede per pagina</p>
      </div>

      <section className={styles.requestGrid} aria-label="Elenco richieste">
        {pageRequests.map((request) => {
          const payload = requestPayload(request);
          const fields = payload.fields ?? {};
          const activities = requestActivityCount(request);
          const compatible = compatibleCounts.get(request.id) ?? 0;
          const isHot = crmField(payload, "Richiesta Calda") === true || request.priority === "urgent";
          const zoneNames = (request.request_zones ?? [])
            .map((item) => item.zone?.name)
            .filter((name): name is string => Boolean(name));

          return (
            <Link
              className={styles.requestCard}
              href={`/requests/${request.id}`}
              key={request.id}
              aria-label={`Apri la richiesta ${cleanRequestTitle(request.title)}`}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardIdentity}>
                  <p className={styles.recordReference}>Richiesta {requestReference(request)}</p>
                  <h2 className={styles.cardTitle}>{cleanRequestTitle(request.title)}</h2>
                  <p className={styles.cardClient}>{request.clients?.full_name || "Cliente da collegare"}</p>
                </div>
                <div className={styles.statusGroup}>
                  {isHot ? <span className={styles.hotBadge}><Flame aria-hidden="true" className="size-3" /> Calda</span> : null}
                  <span className={styles.badge}>{statusLabel(request.status)}</span>
                  <span className={styles.badge}>{request.contract_type === "sale" ? "Acquisto" : "Locazione"}</span>
                </div>
              </div>

              <div className={styles.cardBody}>
                <section className={styles.cardColumn}>
                  <h3 className={styles.columnTitle}>Richiesta</h3>
                  <dl className={styles.fieldList}>
                    <Field label="Tipologia" value={displayValue(fields["Tipologia Immobile"], propertyTypesLabel(request.property_types))} />
                    <Field label="Sottotipologia" value={displayValue(fields["Sottotipologia Immobile"])} />
                    <Field label="Prezzo" value={requestBudget(request)} />
                    <Field label="Superficie" value={requestArea(request)} />
                    <Field label="Locali" value={requestRooms(request)} />
                    <Field label="Esigenza" value={displayValue(fields.Esigenze, request.notes || "Non indicata")} muted />
                  </dl>
                </section>
                <section className={styles.cardColumn}>
                  <h3 className={styles.columnTitle}>Requisiti</h3>
                  <dl className={styles.fieldList}>
                    <Field label="Piano" value={displayValue(fields["Piano Immobile"], floorBandLabel(request.requested_floor_band))} />
                    <Field label="Ascensore" value={displayValue(fields.Ascensore)} />
                    <Field label="Arredato" value={displayValue(fields.Arredato)} />
                    <Field label="Finalità" value={displayValue(fields["Destinazione Richiesta"], destinationLabel(request.destination))} />
                    <Field label="Zona" value={zoneNames.join(", ") || request.municipality || "Tutta Bitonto"} />
                    <Field label="Dettaglio" value={displayValue(fields["Dettaglio Esigenza"], financingLabel(request.financing_method))} muted />
                  </dl>
                </section>
              </div>

              <footer className={styles.cardFooter}>
                <span className={styles.footerFact}><CalendarDays aria-hidden="true" /> {displayValue(payload.headerFields?.["Data Inserimento Richiesta"], formatDate(request.created_at))}</span>
                <span className={styles.footerFact}>{requestSourceLabel(request)}</span>
                <span className={styles.footerFact}><History aria-hidden="true" /> {activities} attività</span>
                <span className={styles.footerFact}>{compatible} compatibili</span>
                <span className={styles.cardAction}>
                  Apri scheda <ArrowUpRight aria-hidden="true" className="size-4" />
                </span>
              </footer>
            </Link>
          );
        })}

        {!pageRequests.length ? (
          <div className={styles.emptyState}>
            <div>
              <UsersRound aria-hidden="true" className="mx-auto size-6 text-[var(--surface-accent)]" />
              <h2 className="mt-4 font-semibold text-[var(--ink-strong)]">Nessuna richiesta trovata</h2>
              <p className="mt-2 text-sm">Prova a modificare la ricerca o ad azzerare i filtri.</p>
            </div>
          </div>
        ) : null}
      </section>

      {totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Paginazione richieste">
          <PaginationLink page={currentPage - 1} disabled={currentPage === 1} params={persistentParams} label="Precedente">
            <ArrowLeft aria-hidden="true" className="size-4" />
          </PaginationLink>
          {paginationWindow(currentPage, totalPages).map((page, index) =>
            typeof page === "number" ? (
              <PaginationLink key={page} page={page} current={page === currentPage} params={persistentParams} label={`Pagina ${page}`}>
                {page}
              </PaginationLink>
            ) : <span key={`${page}-${index}`} className={styles.resultCount}>…</span>,
          )}
          <PaginationLink page={currentPage + 1} disabled={currentPage === totalPages} params={persistentParams} label="Successiva">
            <ArrowRight aria-hidden="true" className="size-4" />
          </PaginationLink>
        </nav>
      ) : null}
    </div>
  );
}

function Filter({ name, label, value: selected, options }: Readonly<{
  name: string;
  label: string;
  value: string;
  options: [string, string][];
}>) {
  return (
    <select className={styles.select} name={name} defaultValue={selected} aria-label={label}>
      <option value="">{label}</option>
      {options.map(([optionValue, optionLabel]) => (
        <option value={optionValue} key={optionValue}>{optionLabel}</option>
      ))}
    </select>
  );
}

function Field({ label, value: content, muted = false }: Readonly<{ label: string; value: string; muted?: boolean }>) {
  return (
    <div className={styles.fieldRow}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={`${styles.fieldValue} ${muted ? styles.fieldValueMuted : ""}`}>{content}</dd>
    </div>
  );
}

function PaginationLink({ page, params, current = false, disabled = false, label, children }: Readonly<{
  page: number;
  params: Record<string, string>;
  current?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}>) {
  const className = [styles.paginationLink, current ? styles.paginationCurrent : "", disabled ? styles.paginationDisabled : ""].join(" ");
  return (
    <Link className={className} href={pageHref(params, page)} aria-label={label} aria-current={current ? "page" : undefined} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
      {children}
    </Link>
  );
}

function pageHref(params: Record<string, string>, page: number) {
  const search = new URLSearchParams();
  for (const [key, item] of Object.entries(params)) if (item) search.set(key, item);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/requests?${query}` : "/requests";
}

function paginationWindow(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const valid = [...pages].filter((page) => page > 0 && page <= total).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  valid.forEach((page, index) => {
    if (index && page - valid[index - 1] > 1) result.push("gap");
    result.push(page);
  });
  return result;
}

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

function propertyTypesLabel(types: string[]) {
  if (!types.length) return "Non indicata";
  return types.map((type) => ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile" }[type] ?? type)).join(", ");
}

function statusLabel(status: string) {
  return ({ draft: "Bozza", active: "Attiva", urgent: "Urgente", suspended: "Sospesa", satisfied: "Soddisfatta", cancelled: "Annullata", archived: "Archiviata" }[status] ?? status);
}

function destinationLabel(destination?: string | null) {
  return ({ first_home: "Prima casa", investment: "Investimento", exchange: "Permuta", temporary: "Esigenza temporanea", other: "Altro" }[destination ?? ""] ?? "Non indicata");
}

function financingLabel(financing?: string | null) {
  return ({ cash: "Contanti", cash_and_mortgage: "Contanti + mutuo", full_mortgage: "Mutuo 100%", exchange: "Permuta", other: "Da definire" }[financing ?? ""] ?? "Non indicato");
}

function floorBandLabel(value?: string | null) {
  return ({ any: "Qualsiasi", low: "Basso", medium: "Medio", high: "Alto", top: "Ultimo piano" }[value ?? ""] ?? "Qualsiasi");
}

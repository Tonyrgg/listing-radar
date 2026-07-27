import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { RecalculateButton } from "@/components/matching/management-panels";
import { listMatches, listProperties, listRequests } from "@/lib/matching/repository";

export default async function MatchingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const [matches, requests, properties] = await Promise.all([listMatches(), listRequests(), listProperties()]);
  const view = query.view === "property" ? "property" : "request";
  const classification = typeof query.classification === "string" ? query.classification : "";
  const contract = typeof query.contract === "string" ? query.contract : "";
  const minimum = typeof query.minimum === "string" ? Number(query.minimum) : 0;
  const requestsById = new Map(requests.map((item) => [item.id, item]));
  const propertiesById = new Map(properties.map((item) => [item.id, item]));
  const filteredMatches = matches.filter((match) => {
    const request = requestsById.get(match.request_id);
    return (!classification || match.classification === classification) &&
      (!contract || request?.contract_type === contract) &&
      match.score >= minimum;
  });
  const stat = (predicate: (match: typeof matches[number]) => boolean) => matches.filter(predicate).length;
  const activeRequests = requests.filter((item) => ["active","urgent"].includes(item.status)).length;
  const activeProperties = properties.filter((item) => item.mandate_status === "active").length;
  const readyToCalculate = activeRequests > 0 && activeProperties > 0;
  const compatibleCount = stat((item) => item.classification === "compatible");
  const almostCount = stat((item) => item.classification === "almost_compatible");
  const toProposeCount = stat((item) => item.status === "to_propose");

  return <div className="space-y-5">
    <PageHeader
      eyebrow="Clienti e immobili"
      title="Trova subito cosa proporre"
      description="Inserisci quello che cerca il cliente e gli immobili disponibili. Listing Radar prepara gli abbinamenti e ti spiega perché funzionano."
      actions={<QuickRequestButton />}
    />
    <MatchingSectionNav />

    <section aria-labelledby="workflow-title" className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line-soft)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--surface-accent)]">Come funziona</p>
          <h2 id="workflow-title" className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">Tre passaggi, sempre nello stesso ordine</h2>
        </div>
      </div>
      <div className="grid md:grid-cols-3">
        <WorkflowStep
          number="1"
          title="Registra cosa cerca il cliente"
          description={activeRequests ? `${activeRequests} richieste pronte per il confronto.` : "Puoi iniziare anche senza nome o telefono."}
          complete={activeRequests > 0}
          action={activeRequests
            ? <Link href="/requests" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--ink-strong)] hover:text-[var(--surface-accent)]">Vedi le richieste <ArrowRight className="size-4" /></Link>
            : <QuickRequestButton />}
        />
        <WorkflowStep
          number="2"
          title="Aggiungi gli immobili disponibili"
          description={activeProperties ? `${activeProperties} immobili pronti per il confronto.` : "Bastano i dati principali. Potrai completarli dopo."}
          complete={activeProperties > 0}
          action={<Link href="/portfolio" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--ink-strong)] hover:text-[var(--surface-accent)]">{activeProperties ? "Vedi gli immobili" : "Aggiungi il primo immobile"} <ArrowRight className="size-4" /></Link>}
        />
        <WorkflowStep
          number="3"
          title="Controlla le proposte"
          description={matches.length ? `${matches.length} abbinamenti già calcolati e spiegati.` : readyToCalculate ? "Tutto pronto. Avvia il confronto automatico." : "Si attiva quando sono presenti richieste e immobili."}
          complete={matches.length > 0}
          action={readyToCalculate
            ? <RecalculateButton scope="all" />
            : <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--ink-subtle)]"><CircleDashed className="size-4" /> In attesa dei primi due passaggi</span>}
        />
      </div>
    </section>

    {!readyToCalculate ? (
      <section className="grid overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <div className="px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex size-11 items-center justify-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
            <Sparkles aria-hidden="true" className="size-5" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-[var(--ink-strong)]">
            {activeRequests === 0 ? "Partiamo dalla richiesta del cliente" : "Ora aggiungi almeno un immobile"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ink-soft)]">
            {activeRequests === 0
              ? "Rispondi a poche domande su budget, zona e caratteristiche. Non devi conoscere già tutti i dati del cliente."
              : "Inserisci un immobile disponibile. Il sistema lo confronterà subito con tutte le richieste attive."}
          </p>
          <div className="mt-6">
            {activeRequests === 0
              ? <QuickRequestButton />
              : <Link href="/portfolio" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">Aggiungi immobile <ArrowRight className="size-4" /></Link>}
          </div>
        </div>
        <div className="border-t border-[var(--line-soft)] bg-[var(--surface-muted)] px-6 py-7 lg:border-l lg:border-t-0">
          <p className="text-xs font-bold uppercase tracking-[.12em] text-[var(--ink-subtle)]">Cosa succede dopo</p>
          <ol className="mt-5 space-y-5">
            <PromiseLine icon={UsersRound} text="La richiesta resta salvata e modificabile." />
            <PromiseLine icon={Building2} text="Ogni immobile viene confrontato automaticamente." />
            <PromiseLine icon={CheckCircle2} text="Vedrai cosa proporre e gli eventuali punti deboli." />
          </ol>
        </div>
      </section>
    ) : (
      <>
        <section className="flex flex-col gap-5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">Situazione attuale</p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              <strong className="text-[var(--ink-strong)]">{compatibleCount}</strong> proposte forti,
              {" "}<strong className="text-[var(--ink-strong)]">{almostCount}</strong> alternative da valutare,
              {" "}<strong className="text-[var(--ink-strong)]">{toProposeCount}</strong> ancora da proporre.
            </p>
          </div>
          <div className="flex gap-1 rounded-[7px] bg-[var(--surface-muted)] p-1">
            <Link href="/matching?view=request" className={`rounded-[6px] px-3 py-2 text-xs font-bold ${view === "request" ? "bg-[var(--surface-panel)] text-[var(--ink-strong)]" : "text-[var(--ink-soft)]"}`}>Parti dal cliente</Link>
            <Link href="/matching?view=property" className={`rounded-[6px] px-3 py-2 text-xs font-bold ${view === "property" ? "bg-[var(--surface-panel)] text-[var(--ink-strong)]" : "text-[var(--ink-soft)]"}`}>Parti dall’immobile</Link>
          </div>
        </section>

        <details className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[var(--ink-soft)]">
            Filtra i risultati
            <ChevronDown aria-hidden="true" className="size-4" />
          </summary>
          <form className="flex flex-wrap gap-2 border-t border-[var(--line-soft)] p-4">
            <input type="hidden" name="view" value={view} />
            <select name="classification" defaultValue={classification} className="h-11 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-soft)]"><option value="">Tutti i risultati</option><option value="compatible">Proposte forti</option><option value="almost_compatible">Alternative valide</option><option value="weak">Compatibilità debole</option><option value="not_relevant">Poco pertinente</option></select>
            <select name="contract" defaultValue={contract} className="h-11 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-soft)]"><option value="">Vendita e affitto</option><option value="sale">Vendita</option><option value="rent">Affitto</option></select>
            <input name="minimum" type="number" min="0" max="100" defaultValue={minimum || ""} placeholder="Compatibilità minima" aria-label="Compatibilità minima" className="h-11 w-44 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-soft)]" />
            <button className="h-11 rounded-[7px] border border-[var(--line-strong)] px-4 text-sm font-bold text-[var(--ink-strong)]">Mostra risultati</button>
          </form>
        </details>

        <section className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">{view === "request" ? "Cosa proporre a ogni cliente" : "A chi proporre ogni immobile"}</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">Proposte ordinate dalla più adatta</h2>
            </div>
            <p className="text-sm text-[var(--ink-subtle)]">I punti deboli sono sempre spiegati</p>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">{filteredMatches.slice(0, 30).map((match) => {
        const request = requestsById.get(match.request_id);
        const property = propertiesById.get(match.property_id);
        const primary = view === "request"
          ? <Link href={`/requests/${match.request_id}`} className="text-sm font-semibold text-[var(--ink-strong)] hover:underline">{request?.title || "Richiesta anonima"}</Link>
          : <Link href={`/portfolio/${match.property_id}`} className="text-sm font-semibold text-[var(--ink-strong)] hover:underline">{property?.title || "Immobile"}</Link>;
        const secondary = view === "request"
          ? <Link href={`/portfolio/${match.property_id}`} className="text-sm text-[var(--ink-soft)] hover:underline">{property?.title || "Immobile"}</Link>
          : <Link href={`/requests/${match.request_id}`} className="text-sm text-[var(--ink-soft)] hover:underline">{request?.title || "Richiesta anonima"}</Link>;
        return <div key={match.id} className="grid gap-4 px-5 py-4 md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_140px] md:items-center"><div><strong className="text-xl text-[var(--ink-strong)]">{Math.round(match.score)}%</strong><p className="text-[10px] uppercase text-[var(--ink-subtle)]">{match.classification.replace("_"," ")}</p></div>{primary}{secondary}<span className="text-xs font-semibold text-[var(--surface-accent)]">{match.status.replaceAll("_"," ")}</span></div>;
      })}{!filteredMatches.length ? <p className="p-10 text-center text-sm text-[var(--ink-soft)]">{matches.length ? "Nessun match corrisponde ai filtri." : "Inserisci almeno una richiesta attiva e un immobile attivo, quindi avvia il ricalcolo."}</p> : null}</div>
        </section>
      </>
    )}
  </div>;
}

function WorkflowStep({
  number,
  title,
  description,
  complete,
  action,
}: Readonly<{
  number: string;
  title: string;
  description: string;
  complete: boolean;
  action: React.ReactNode;
}>) {
  return (
    <div className="border-b border-[var(--line-soft)] px-5 py-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="flex items-center gap-3">
        <span className={`grid size-8 place-items-center rounded-full text-sm font-bold ${complete ? "bg-[var(--surface-accent)] text-[var(--button-ink)]" : "bg-[var(--surface-muted)] text-[var(--ink-soft)]"}`}>
          {complete ? <CheckCircle2 aria-label="Completato" className="size-4" /> : number}
        </span>
        <h3 className="font-semibold text-[var(--ink-strong)]">{title}</h3>
      </div>
      <p className="mt-3 min-h-10 text-sm leading-5 text-[var(--ink-soft)]">{description}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

function PromiseLine({
  icon: Icon,
  text,
}: Readonly<{
  icon: typeof UsersRound;
  text: string;
}>) {
  return (
    <li className="flex gap-3 text-sm leading-5 text-[var(--ink-soft)]">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]" />
      {text}
    </li>
  );
}

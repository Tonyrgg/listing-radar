import {
  Activity,
  CircleAlert,
  Clock3,
  ContactRound,
  Database,
  Download,
  FileWarning,
  House,
  Pause,
  Play,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { createPropertyWorkerJob, pausePropertyWorkerJob, resumePropertyWorkerJob } from "./actions";
import { Badge, type BadgeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/formatting";
import { getPropertyWorkerDashboard } from "@/lib/property-worker/repository";
import type { PropertyWorkerJob } from "@/lib/property-worker/types";

const REVIEW_STATUSES = new Set(["needs_review", "data_incomplete"]);
const ERROR_STATUSES = new Set(["session_expired", "portal_error", "failed"]);
const ACTIVE_STATUSES = new Set(["ready", "running", "paused"]);

function statusTone(status: string): BadgeTone {
  if (status === "completed") return "green";
  if (REVIEW_STATUSES.has(status) || status === "paused") return "amber";
  if (ERROR_STATUSES.has(status)) return "red";
  if (status === "running") return "blue";
  return "slate";
}

function statusLabel(status: string) {
  return ({ ready: "Pronto", running: "In corso", paused: "In pausa", completed: "Completato", needs_review: "Da verificare", data_incomplete: "Dati incompleti", session_expired: "Sessione scaduta", portal_error: "Errore portale", failed: "Fallito" } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

function stepLabel(step: string | null) {
  if (!step) return "Non avviato";
  return step.replaceAll("_", " ");
}

function JobRow({ job, selected }: Readonly<{ job: PropertyWorkerJob; selected: boolean }>) {
  const location = [job.municipality, job.street, job.civicNumber].filter(Boolean).join(" · ") || "Contesto acquisito da SISTER";
  return (
    <Link
      href={`/property-worker?job=${job.id}`}
      aria-current={selected ? "page" : undefined}
      className={`group block border-t border-[var(--line-soft)] px-4 py-3.5 first:border-t-0 transition-colors ${selected ? "bg-[var(--surface-muted)]" : "hover:bg-[oklch(0.245_0.014_160)]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">{location}</p>
          <p className="mt-1 truncate text-[11px] text-[var(--ink-subtle)]">{job.id}</p>
        </div>
        <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
        <span>{job.totalProperties} immobili · {job.totalPeople} nominativi</span>
        <span>{formatDate(job.updatedAt)}</span>
      </div>
    </Link>
  );
}

function QueueSection({ title, jobs, selectedId }: Readonly<{ title: string; jobs: PropertyWorkerJob[]; selectedId?: string }>) {
  if (!jobs.length) return null;
  return (
    <section>
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">{title}</h2>
        <span className="text-xs font-semibold text-[var(--ink-soft)]">{jobs.length}</span>
      </div>
      {jobs.map((job) => <JobRow key={job.id} job={job} selected={job.id === selectedId} />)}
    </section>
  );
}

function Metric({ icon: Icon, value, label, detail }: Readonly<{ icon: typeof House; value: string | number; label: string; detail: string }>) {
  return (
    <div className="min-w-0 border-l border-[var(--line-soft)] px-5 first:border-l-0">
      <div className="flex items-center gap-2 text-[var(--ink-subtle)]"><Icon aria-hidden="true" className="size-3.5" /><span className="text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span></div>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink-strong)]">{value}</p>
      <p className="mt-1 truncate text-xs text-[var(--ink-subtle)]">{detail}</p>
    </div>
  );
}

function ProgressRail({ job }: Readonly<{ job: PropertyWorkerJob }>) {
  const propertyProgress = job.totalProperties ? Math.round(job.processedProperties / job.totalProperties * 100) : 0;
  const peopleProgress = job.totalPeople ? Math.round(job.processedPeople / job.totalPeople * 100) : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[["Immobili", job.processedProperties, job.totalProperties, propertyProgress], ["Nominativi", job.processedPeople, job.totalPeople, peopleProgress]].map(([label, done, total, percent]) => (
        <div key={String(label)}>
          <div className="flex justify-between text-xs"><span className="font-semibold text-[var(--ink-soft)]">{label}</span><span className="text-[var(--ink-subtle)]">{done}/{total}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"><span className="block h-full rounded-full bg-[var(--surface-accent)]" style={{ width: `${percent}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default async function PropertyWorkerPage({ searchParams }: PageProps<"/property-worker">) {
  await connection();
  const requestedJob = (await searchParams).job;
  const data = await getPropertyWorkerDashboard(typeof requestedJob === "string" ? requestedJob : undefined);
  const active = data.jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
  const review = data.jobs.filter((job) => REVIEW_STATUSES.has(job.status));
  const errors = data.jobs.filter((job) => ERROR_STATUSES.has(job.status));
  const completed = data.jobs.filter((job) => job.status === "completed");
  const selected = data.selectedJob;
  const contactsFound = data.people.reduce((total, person) => total + person.mobiles.length + person.landlines.length + person.emails.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Property Data Worker" title="Cabina di lavorazione catastale" description="Coda persistente, controlli e audit del worker locale. Chrome resta sotto il controllo dell’operatore." actions={<div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]"><span className="size-2 rounded-full bg-[var(--status-warning)]" /> Worker locale</div><a href="/api/property-worker/download" className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[var(--surface-accent)] px-3 text-xs font-bold text-[var(--button-ink)] hover:bg-[var(--surface-accent-hover)]"><Download aria-hidden="true" className="size-3.5" />Scarica software</a></div>} />

      {!data.available ? (
        <div className="flex gap-3 rounded-[10px] border border-[oklch(0.42_0.07_80)] bg-[oklch(0.235_0.035_80)] p-4 text-sm text-[var(--status-warning)]">
          <Database aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">Modulo in attesa del database</p><p className="mt-1 leading-6">{data.errorMessage}</p></div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <div className="grid gap-0 divide-y divide-[var(--line-soft)] lg:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)] lg:divide-x lg:divide-y-0">
          <form action={createPropertyWorkerJob} className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"><Play aria-hidden="true" className="size-4" /></span>
              <div><h2 className="text-sm font-semibold text-[var(--ink-strong)]">Nuova lavorazione</h2><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Prepara la coda; l’acquisizione parte solo dal terminale locale.</p></div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-[var(--ink-soft)]">Comune<input name="municipality" placeholder="Es. Bitonto" className="mt-2 h-10 w-full rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-sm" /></label>
              <label className="text-xs font-semibold text-[var(--ink-soft)]">Via<input name="street" placeholder="Facoltativa" className="mt-2 h-10 w-full rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-sm" /></label>
              <label className="text-xs font-semibold text-[var(--ink-soft)]">Civico<input name="civicNumber" placeholder="Facoltativo" className="mt-2 h-10 w-full rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-sm" /></label>
            </div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <label className="text-xs font-semibold text-[var(--ink-soft)]">Modalità<select name="mode" defaultValue="assisted" className="ml-3 h-10 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-sm"><option value="assisted">Assisted</option><option value="automatic">Automatic</option></select></label>
              <button disabled={!data.available} className="inline-flex h-10 items-center gap-2 rounded-[7px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] disabled:opacity-40"><Play aria-hidden="true" className="size-4" />Crea lavorazione</button>
            </div>
          </form>

          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line-soft)] p-5 sm:grid-cols-4 sm:divide-y-0">
            <Metric icon={Activity} value={active.length} label="In corso" detail="pronti, attivi o in pausa" />
            <Metric icon={CircleAlert} value={review.length} label="Da verificare" detail="richiedono una decisione" />
            <Metric icon={House} value={data.jobs.reduce((sum, job) => sum + job.totalProperties, 0)} label="Immobili" detail="acquisiti complessivi" />
            <Metric icon={ContactRound} value={data.jobs.reduce((sum, job) => sum + job.totalPeople, 0)} label="Nominativi" detail="proprietari rilevati" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="self-start overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] xl:sticky xl:top-5">
          {data.jobs.length ? <><QueueSection title="In corso" jobs={active} selectedId={selected?.id} /><QueueSection title="Da verificare" jobs={review} selectedId={selected?.id} /><QueueSection title="Errori" jobs={errors} selectedId={selected?.id} /><QueueSection title="Completati" jobs={completed} selectedId={selected?.id} /></> : <div className="p-8 text-center"><SquareTerminal aria-hidden="true" className="mx-auto size-7 text-[var(--ink-subtle)]" /><p className="mt-3 text-sm font-semibold">La coda è vuota</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Crea la prima lavorazione in modalità assisted.</p></div>}
        </aside>

        {selected ? (
          <div className="min-w-0 space-y-4">
            <section className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge><Badge tone="slate">{selected.mode}</Badge></div><h2 className="mt-3 truncate text-xl font-semibold tracking-[-0.02em]">{[selected.municipality, selected.street, selected.civicNumber].filter(Boolean).join(" · ") || "Lavorazione senza contesto"}</h2><p className="mt-2 text-xs text-[var(--ink-subtle)]">ID {selected.id}</p></div>
                <div className="flex gap-2">
                  {selected.status !== "completed" && selected.status !== "paused" ? <form action={pausePropertyWorkerJob}><input type="hidden" name="jobId" value={selected.id} /><button className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--line-soft)] px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"><Pause aria-hidden="true" className="size-3.5" />Pausa</button></form> : null}
                  {selected.status !== "completed" && selected.status !== "running" ? <form action={resumePropertyWorkerJob}><input type="hidden" name="jobId" value={selected.id} /><button className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[var(--surface-accent)] px-3 text-xs font-bold text-[var(--button-ink)] hover:bg-[var(--surface-accent-hover)]"><Play aria-hidden="true" className="size-3.5" />Riprendi</button></form> : null}
                </div>
              </div>
              <div className="mt-6"><ProgressRail job={selected} /></div>
              <dl className="mt-6 grid gap-4 border-t border-[var(--line-soft)] pt-5 sm:grid-cols-3">
                <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Ultimo step completato</dt><dd className="mt-2 text-sm font-semibold capitalize">{stepLabel(selected.lastCompletedStep)}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Step corrente</dt><dd className="mt-2 text-sm font-semibold capitalize">{stepLabel(selected.currentStep)}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Ultimo aggiornamento</dt><dd className="mt-2 text-sm font-semibold">{formatDateTime(selected.updatedAt)}</dd></div>
              </dl>
              {selected.errorMessage ? <div className="mt-5 flex gap-3 rounded-[8px] border border-[oklch(0.42_0.07_28)] bg-[oklch(0.235_0.035_28)] p-4 text-sm text-[var(--status-error)]"><FileWarning aria-hidden="true" className="size-5 shrink-0" /><div><p className="font-semibold">{selected.errorMessage}</p>{selected.errorDetails ? <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] opacity-80">{JSON.stringify(selected.errorDetails, null, 2)}</pre> : null}</div></div> : null}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Recapiti trovati</p><p className="mt-2 text-2xl font-semibold">{formatNumber(contactsFound)}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">telefoni ed email consolidati</p></div>
              <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Avviato</p><p className="mt-2 text-sm font-semibold">{formatDateTime(selected.startedAt)}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">Creato {formatDateTime(selected.createdAt)}</p></div>
              <div className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">Completato</p><p className="mt-2 text-sm font-semibold">{formatDateTime(selected.completedAt)}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">stato persistito su Supabase</p></div>
            </section>

            <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4"><div><h2 className="text-sm font-semibold">Immobili e proprietari</h2><p className="mt-1 text-xs text-[var(--ink-soft)]">Catasto, quote e associazioni CRM</p></div><House aria-hidden="true" className="size-4 text-[var(--ink-subtle)]" /></div>
              {data.properties.length ? data.properties.map((property) => {
                const links = data.ownerships.filter((ownership) => ownership.propertyId === property.id);
                return <article key={property.id} className="border-t border-[var(--line-soft)] px-5 py-4 first:border-t-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold">{property.cadastralKey}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">{property.address ?? "Indirizzo non disponibile"} · {property.category ?? "Categoria n/d"} · classe {property.class ?? "n/d"}</p><p className="mt-1 text-xs text-[var(--ink-subtle)]">{property.consistency ?? "Consistenza n/d"} · {formatCurrency(property.cadastralIncome)}</p></div><Badge tone="slate">{statusLabel(property.processingStatus)}</Badge></div><div className="mt-4 grid gap-2">{links.map((ownership) => { const person = data.people.find((item) => item.id === ownership.personId); return person ? <div key={ownership.id} className="grid gap-2 rounded-[7px] bg-[var(--surface-muted)] px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><div><span className="font-semibold text-[var(--ink-strong)]">{person.fullName}</span><span className="ml-2 text-[var(--ink-subtle)]">{person.taxCode ?? "CF mancante"}</span></div><span className="text-[var(--ink-soft)]">{ownership.rightType}</span><span className="font-semibold text-[var(--surface-accent)]">{ownership.sharePercentage?.toLocaleString("it-IT") ?? "?"}%</span></div> : null; })}</div></article>;
              }) : <p className="px-5 py-8 text-center text-sm text-[var(--ink-soft)]">Gli immobili appariranno dopo l’acquisizione SISTER.</p>}
            </section>

            <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
              <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4"><div><h2 className="text-sm font-semibold">Nominativi e recapiti</h2><p className="mt-1 text-xs text-[var(--ink-soft)]">Matching Excel per codice fiscale</p></div><ContactRound aria-hidden="true" className="size-4 text-[var(--ink-subtle)]" /></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-subtle)]"><tr><th className="px-5 py-3">Nominativo</th><th className="px-3 py-3">Nascita</th><th className="px-3 py-3">Telefoni</th><th className="px-3 py-3">Email</th><th className="px-5 py-3 text-right">Stato</th></tr></thead><tbody>{data.people.map((person) => <tr key={person.id} className="border-t border-[var(--line-soft)]"><td className="px-5 py-3"><p className="font-semibold text-[var(--ink-strong)]">{person.fullName}</p><p className="mt-1 text-[var(--ink-subtle)]">{person.taxCode ?? "CF mancante"}</p></td><td className="px-3 py-3 text-[var(--ink-soft)]">{person.birthPlace ?? "—"}<br />{person.birthDate ? formatDate(person.birthDate) : "—"}</td><td className="px-3 py-3 text-[var(--ink-soft)]">{[...person.mobiles, ...person.landlines].join(" · ") || "—"}</td><td className="px-3 py-3 text-[var(--ink-soft)]">{person.emails.join(" · ") || "—"}</td><td className="px-5 py-3 text-right"><Badge tone="slate">{statusLabel(person.processingStatus)}</Badge></td></tr>)}</tbody></table></div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]"><div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4"><h2 className="text-sm font-semibold">Timeline step</h2><Clock3 aria-hidden="true" className="size-4 text-[var(--ink-subtle)]" /></div><div className="max-h-[420px] overflow-y-auto px-5">{data.steps.map((step) => <div key={step.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 border-t border-[var(--line-soft)] py-3 first:border-t-0"><span className={`mt-1.5 size-2 rounded-full ${step.status === "completed" ? "bg-[var(--surface-accent)]" : ERROR_STATUSES.has(step.status) ? "bg-[var(--status-error)]" : "bg-[var(--status-warning)]"}`} /><div><div className="flex justify-between gap-3"><p className="text-xs font-semibold capitalize">{stepLabel(step.stepName)}</p><span className="text-[10px] text-[var(--ink-subtle)]">{formatDateTime(step.completedAt ?? step.startedAt)}</span></div>{step.errorMessage ? <p className="mt-1 text-xs text-[var(--status-error)]">{step.errorMessage}</p> : null}{step.screenshotPath ? <p className="mt-2 break-all rounded bg-[var(--surface-canvas)] p-2 text-[10px] text-[var(--ink-soft)]">Screenshot locale: {step.screenshotPath}</p> : null}</div></div>)}{!data.steps.length ? <p className="py-8 text-center text-sm text-[var(--ink-soft)]">Nessuno step registrato.</p> : null}</div></section>
              <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]"><div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4"><h2 className="text-sm font-semibold">Log modifiche</h2><ShieldCheck aria-hidden="true" className="size-4 text-[var(--ink-subtle)]" /></div><div className="max-h-[420px] overflow-y-auto px-5">{data.changeLogs.map((log) => <div key={log.id} className="border-t border-[var(--line-soft)] py-3 first:border-t-0"><div className="flex justify-between gap-3"><p className="text-xs font-semibold">{log.entityType} · {log.fieldName}</p><span className="text-[10px] text-[var(--ink-subtle)]">{formatDateTime(log.createdAt)}</span></div><p className="mt-1 truncate text-[11px] text-[var(--ink-subtle)]">{log.entityIdentifier}</p><p className="mt-2 text-xs text-[var(--ink-soft)]"><span className="line-through opacity-60">{log.oldValue ?? "vuoto"}</span><span className="mx-2 text-[var(--surface-accent)]">→</span>{log.newValue ?? "vuoto"}</p></div>)}{!data.changeLogs.length ? <p className="py-8 text-center text-sm text-[var(--ink-soft)]">Nessuna modifica registrata.</p> : null}</div></section>
            </div>
          </div>
        ) : (
          <section className="flex min-h-[420px] items-center justify-center rounded-[10px] border border-dashed border-[var(--line-strong)] bg-[oklch(0.19_0.012_160_/_0.5)] p-8 text-center"><div><SquareTerminal aria-hidden="true" className="mx-auto size-9 text-[var(--surface-accent)]" /><h2 className="mt-4 text-lg font-semibold">Pronto per il primo dry-run</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-soft)]">Crea una lavorazione assisted, poi esegui <code className="rounded bg-[var(--surface-muted)] px-1.5 py-1 text-xs">npm run worker:start:assisted</code> sul computer collegato a Chrome.</p></div></section>
        )}
      </div>
    </div>
  );
}

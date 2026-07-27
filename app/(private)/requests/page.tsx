import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { listMatches, listRequests } from "@/lib/matching/repository";

export default async function RequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const filters = await searchParams;
  const [requests, matches] = await Promise.all([listRequests(), listMatches()]);
  const status = typeof filters.status === "string" ? filters.status : "";
  const contract = typeof filters.contract === "string" ? filters.contract : "";
  const priority = typeof filters.priority === "string" ? filters.priority : "";
  const client = typeof filters.client === "string" ? filters.client : "";
  const filteredRequests = requests.filter((request) =>
    (!status || request.status === status) &&
    (!contract || request.contract_type === contract) &&
    (!priority || request.priority === priority) &&
    (!client || (client === "anonymous" ? !request.client_id : Boolean(request.client_id))),
  );
  const counts = new Map<string, { compatible: number; almost: number }>();
  for (const match of matches) {
    const current = counts.get(match.request_id) ?? { compatible: 0, almost: 0 };
    if (match.classification === "compatible") current.compatible++;
    if (match.classification === "almost_compatible") current.almost++;
    counts.set(match.request_id, current);
  }
  return <div className="space-y-5">
    <PageHeader eyebrow="Clienti e immobili" title="Cosa cercano i clienti" description="Ogni richiesta raccoglie budget, zone e caratteristiche. Puoi iniziare anche senza conoscere nome o telefono." actions={<QuickRequestButton />} />
    <MatchingSectionNav />
    {requests.length ? <form className="grid gap-2 rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-3 sm:grid-cols-4">
      <Filter name="status" label="Tutti gli stati" value={status} options={[["draft","Bozza"],["active","Attiva"],["urgent","Urgente"],["suspended","Sospesa"],["satisfied","Soddisfatta"],["archived","Archiviata"]]} />
      <Filter name="contract" label="Vendita e affitto" value={contract} options={[["sale","Vendita"],["rent","Affitto"]]} />
      <Filter name="priority" label="Tutte le priorità" value={priority} options={[["low","Bassa"],["normal","Normale"],["high","Alta"],["urgent","Urgente"]]} />
      <div className="flex gap-2"><Filter name="client" label="Tutti i clienti" value={client} options={[["anonymous","Anonime"],["linked","Con cliente"]]} /><button className="min-h-10 rounded-[7px] bg-[var(--surface-muted)] px-3 text-xs font-bold text-[var(--ink-strong)]">Filtra</button></div>
    </form> : null}
    <section className="grid gap-3">
      {filteredRequests.map((request) => {
        const matchCount = counts.get(request.id) ?? { compatible: 0, almost: 0 };
        const value = request.contract_type === "sale" ? request.budget_max : request.monthly_rent_max;
        return <Link key={request.id} href={`/requests/${request.id}`} className="grid gap-4 rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 transition-colors hover:border-[var(--line-strong)] md:grid-cols-[minmax(0,1fr)_repeat(4,minmax(90px,auto))] md:items-center">
          <div><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">{request.contract_type === "sale" ? "Acquisto" : "Affitto"} · {request.priority}</p><h2 className="mt-1 font-semibold text-[var(--ink-strong)]">{request.title || "Richiesta senza titolo"}</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">{request.clients?.full_name || "Anonima"} · {request.property_types.join(", ")}</p></div>
          <Stat label={request.contract_type === "sale" ? "Budget max" : "Canone max"} value={value ? `€ ${Number(value).toLocaleString("it-IT")}` : "—"} />
          <Stat label="Mq" value={request.internal_sqm_min ? `${request.internal_sqm_min}+` : "—"} />
          <Stat label="Compatibili" value={String(matchCount.compatible)} accent />
          <Stat label="Quasi" value={String(matchCount.almost)} />
        </Link>;
      })}
      {!filteredRequests.length ? <Empty message={requests.length ? "Nessuna richiesta corrisponde ai filtri selezionati." : "Non ci sono ancora richieste. Apri “Nuova richiesta rapida”: puoi salvarla anche senza cliente."} /> : null}
    </section>
  </div>;
}
function Filter({ name, label, value, options }: Readonly<{ name: string; label: string; value: string; options: [string,string][] }>) {
  return <select name={name} defaultValue={value} aria-label={label} className="h-10 min-w-0 flex-1 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-xs font-semibold text-[var(--ink-soft)]"><option value="">{label}</option>{options.map(([optionValue,optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>;
}

function Stat({ label, value, accent = false }: Readonly<{ label: string; value: string; accent?: boolean }>) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[var(--ink-subtle)]">{label}</p><p className={`mt-1 text-sm font-semibold ${accent ? "text-[var(--surface-accent)]" : "text-[var(--ink-strong)]"}`}>{value}</p></div>;
}
function Empty({ message }: Readonly<{ message: string }>) {
  return <div className="rounded-[9px] border border-dashed border-[var(--line-soft)] p-10 text-center text-sm text-[var(--ink-soft)]">{message}</div>;
}

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MatchCard } from "@/components/matching/match-card";
import { RecalculateButton, RequestControls } from "@/components/matching/management-panels";
import { getRequest, listClients } from "@/lib/matching/repository";
import type { MatchClassification, MatchStatus } from "@/lib/matching/types";

export default async function RequestDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, clients] = await Promise.all([getRequest(id), listClients()]);
  if (!detail) notFound();
  const request = detail.request;
  return <div className="space-y-5">
    <PageHeader eyebrow="Dettaglio richiesta" title={request.title || "Richiesta anonima"} description={`${request.clients?.full_name || "Nessun cliente collegato"} · ${request.contract_type === "sale" ? "Acquisto" : "Affitto"}`} backHref="/requests" backLabel="Torna alle richieste" actions={<RecalculateButton scope="request" id={id} />} />
    <RequestControls id={id} status={request.status} clients={clients} clientId={request.client_id} />
    <section className="grid gap-4 lg:grid-cols-3">
      <Info title="Criteri principali" rows={[
        ["Tipologie", request.property_types?.join(", ") || "—"],
        ["Budget/canone massimo", String(request.contract_type === "sale" ? request.budget_max ?? "—" : request.monthly_rent_max ?? "—")],
        ["Mq interni", `${request.internal_sqm_min ?? "—"} – ${request.internal_sqm_max ?? "—"}`],
        ["Vani", `${request.rooms_min ?? "—"} – ${request.rooms_max ?? "—"}`],
      ]} />
      <Info title="Zone" rows={(detail.zones.length ? detail.zones : [{ zone: { name: "Nessuna zona" }, preference_level: "—" }]).map((item) => [item.zone?.name ?? "Zona", item.preference_level])} />
      <Info title="Preferenze" rows={(detail.features.length ? detail.features : [{ feature: { label: "Nessuna preferenza specifica" }, preference_level: "—" }]).map((item) => [item.feature?.label ?? "Criterio", item.preference_level])} />
    </section>
    <section><div className="mb-3 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">Risultati spiegati</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">Immobili ordinati per compatibilità</h2></div><span className="text-sm text-[var(--ink-subtle)]">{detail.matches.length} risultati</span></div><div className="grid gap-3 xl:grid-cols-2">{detail.matches.map((match) => <MatchCard key={match.id} match={{ ...match, classification: match.classification as MatchClassification, status: match.status as MatchStatus }} counterpartHref={`/portfolio/${match.property_id}`} counterpartTitle={match.property?.title ?? "Immobile"} />)}{!detail.matches.length ? <p className="rounded-[9px] border border-dashed border-[var(--line-soft)] p-8 text-center text-sm text-[var(--ink-soft)]">Nessun match calcolato. Inserisci almeno un immobile attivo e premi “Ricalcola match”.</p> : null}</div></section>
    <section className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4"><h2 className="font-semibold text-[var(--ink-strong)]">Storico modifiche</h2><div className="mt-3 divide-y divide-[var(--line-soft)]">{detail.logs.map((log) => <div key={log.id} className="flex justify-between gap-4 py-3 text-sm"><span className="text-[var(--ink-soft)]">{String(log.action).replaceAll("_"," ")}</span><time className="text-xs text-[var(--ink-subtle)]">{new Date(log.created_at).toLocaleString("it-IT")}</time></div>)}{!detail.logs.length ? <p className="py-4 text-sm text-[var(--ink-subtle)]">Nessuna modifica registrata.</p> : null}</div></section>
  </div>;
}
function Info({ title, rows }: Readonly<{ title: string; rows: [string,string][] }>) {
  return <article className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4"><h2 className="font-semibold text-[var(--ink-strong)]">{title}</h2><dl className="mt-4 space-y-3">{rows.map(([label,value], index) => <div key={`${label}-${index}`} className="flex justify-between gap-4 border-t border-[var(--line-soft)] pt-3 text-sm"><dt className="text-[var(--ink-soft)]">{label}</dt><dd className="text-right font-semibold text-[var(--ink-strong)]">{value}</dd></div>)}</dl></article>;
}

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PropertyEditor } from "@/components/matching/management-panels";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { listFeatures, listProperties, listZones } from "@/lib/matching/repository";

export default async function PortfolioPage() {
  const [properties, zones, features] = await Promise.all([listProperties(), listZones(), listFeatures()]);
  return <div className="space-y-5">
    <PageHeader eyebrow="Clienti e immobili" title="Immobili da proporre" description="Qui trovi gli immobili che il sistema confronterà con le richieste attive." actions={<PropertyEditor zones={zones} features={features} />} />
    <MatchingSectionNav />
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{properties.map((property) => <Link key={property.id} href={`/portfolio/${property.id}`} className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 hover:border-[var(--line-strong)]"><div className="flex justify-between gap-3"><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">{property.contract_type === "sale" ? "Vendita" : "Affitto"}</p><span className="text-xs text-[var(--ink-subtle)]">{property.mandate_status}</span></div><h2 className="mt-2 font-semibold text-[var(--ink-strong)]">{property.title}</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">{property.address || property.municipality || "Indirizzo non indicato"}</p><div className="mt-4 flex gap-4 text-sm text-[var(--ink-strong)]"><span>{property.internal_sqm ?? "—"} mq</span><span>{property.rooms ?? "—"} vani</span><strong>{property.contract_type === "sale" ? property.price ? `€ ${Number(property.price).toLocaleString("it-IT")}` : "—" : property.monthly_rent ? `€ ${Number(property.monthly_rent).toLocaleString("it-IT")}/mese` : "—"}</strong></div></Link>)}{!properties.length ? <p className="col-span-full rounded-[9px] border border-dashed border-[var(--line-soft)] p-10 text-center text-sm text-[var(--ink-soft)]">Il portafoglio è vuoto. Inserisci il primo immobile manualmente.</p> : null}</div>
  </div>;
}

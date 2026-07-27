import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MatchCard } from "@/components/matching/match-card";
import { DeletePropertyButton, PropertyEditor, RecalculateButton } from "@/components/matching/management-panels";
import { getProperty, listFeatures, listZones } from "@/lib/matching/repository";
import type { MatchClassification, MatchStatus, PortfolioProperty } from "@/lib/matching/types";

export default async function PropertyDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, zones, features] = await Promise.all([getProperty(id), listZones(), listFeatures()]);
  if (!detail) notFound();
  const featureValues = Object.fromEntries(detail.features.map((item) => [item.feature_definition_id, item.value]));
  return <div className="space-y-5">
    <PageHeader eyebrow="Scheda immobile" title={detail.property.title} description={detail.property.address || detail.property.municipality || "Indirizzo non indicato"} backHref="/portfolio" backLabel="Torna al portafoglio" actions={<div className="flex gap-2"><RecalculateButton scope="property" id={id} /><DeletePropertyButton id={id} /></div>} />
    <PropertyEditor zones={zones} features={features} property={{ ...(detail.property as PortfolioProperty), feature_values: featureValues }} />
    <section><h2 className="mb-3 text-lg font-semibold text-[var(--ink-strong)]">Richieste e clienti compatibili</h2><div className="grid gap-3 xl:grid-cols-2">{detail.matches.map((match) => <MatchCard key={match.id} match={{ ...match, classification: match.classification as MatchClassification, status: match.status as MatchStatus }} counterpartHref={`/requests/${match.request_id}`} counterpartTitle={`${match.request?.clients?.full_name || "Richiesta anonima"} — ${match.request?.title || "Senza titolo"}`} />)}{!detail.matches.length ? <p className="rounded-[9px] border border-dashed border-[var(--line-soft)] p-8 text-center text-sm text-[var(--ink-soft)]">Nessuna richiesta confrontata con questo immobile.</p> : null}</div></section>
  </div>;
}

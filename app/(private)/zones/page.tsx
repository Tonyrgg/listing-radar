import { PageHeader } from "@/components/page-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { ZoneEditor } from "@/components/matching/management-panels";
import { listZones } from "@/lib/matching/repository";

export default async function ZonesPage() {
  const zones = await listZones();
  return <div className="space-y-5"><PageHeader eyebrow="Richieste e Matching" title="Zone interne" description="I nomi usati davvero dall’ufficio, con alias, riferimenti e vie che aiutano a suggerire la zona senza assegnarla automaticamente." /><MatchingSectionNav /><ZoneEditor zones={zones} /></div>;
}


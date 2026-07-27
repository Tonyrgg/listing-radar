import { MatchingSectionNav } from "@/components/matching/section-nav";
import { ZoneShowroom } from "@/components/matching/zone-showroom";
import { PageHeader } from "@/components/page-header";
import { listZones } from "@/lib/matching/repository";

export default async function ZonesPage() {
  const zones = await listZones();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Clienti e immobili"
        title="Le zone come le chiami in ufficio"
        description="Raccogli vie, alias e punti di riferimento. Quando inserisci un indirizzo, Listing Radar ti suggerisce la zona corretta."
      />
      <MatchingSectionNav />
      <ZoneShowroom zones={zones} />
    </div>
  );
}

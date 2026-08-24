import { MatchingSectionNav } from "@/components/matching/section-nav";
import { ZoneShowroom } from "@/components/matching/zone-showroom";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import { listZones } from "@/lib/matching/repository";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Zone immobiliari" };

export default async function ZonesPage() {
  const zones = await listZones();
  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Clienti e immobili"
        title="Zone immobiliari"
        description="Quartieri e perimetri usati per localizzare immobili, richieste e matching. Separati dalle aree operative degli agenti."
      />
      <MatchingSectionNav />
      <ZoneShowroom zones={zones} />
    </div>
  );
}

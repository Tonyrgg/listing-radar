import { MatchingSectionNav } from "@/components/matching/section-nav";
import { ZoneShowroom } from "@/components/matching/zone-showroom";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import { listZones } from "@/lib/matching/repository";

export default async function ZonesPage() {
  const zones = await listZones();
  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Clienti e immobili"
        title="Zone di Bitonto"
        description="Vie, alias e riferimenti usati per classificare richieste e immobili."
      />
      <MatchingSectionNav />
      <ZoneShowroom zones={zones} />
    </div>
  );
}

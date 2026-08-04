import { MatchingSectionNav } from "@/components/matching/section-nav";
import { ZoneShowroom } from "@/components/matching/zone-showroom";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import { listZones } from "@/lib/matching/repository";
import { listMapAreas } from "@/lib/map/queries";

export default async function ZonesPage() {
  const [zones, areas] = await Promise.all([listZones(), listMapAreas()]);
  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Clienti e immobili"
        title="Zone di Bitonto"
        description="Vie, alias e riferimenti usati per classificare richieste e immobili."
      />
      <MatchingSectionNav />
      <ZoneShowroom zones={zones} areas={areas} />
    </div>
  );
}

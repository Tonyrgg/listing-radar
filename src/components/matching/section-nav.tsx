import { Building2, Gauge, MapPinned, ScanSearch, Settings2, UsersRound } from "lucide-react";

import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/matching/overview", label: "Panoramica", icon: Gauge },
  { href: "/matching", label: "Abbinamenti", icon: ScanSearch },
  { href: "/requests", label: "Richieste clienti", icon: UsersRound },
  { href: "/portfolio", label: "Immobili disponibili", icon: Building2 },
  { href: "/zones", label: "Zone immobiliari", icon: MapPinned },
  { href: "/matching-settings", label: "Regole automatiche", icon: Settings2 },
] as const;

export function MatchingSectionNav() {
  return (
    <SectionNav
      items={items}
      ariaLabel="Sezioni dell'area commerciale"
      exact={["/matching"]}
    />
  );
}

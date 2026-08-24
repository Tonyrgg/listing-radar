import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/matching/overview", label: "Panoramica", icon: "gauge" },
  { href: "/matching", label: "Abbinamenti", icon: "scan" },
  { href: "/requests", label: "Richieste clienti", icon: "users" },
  { href: "/portfolio", label: "Immobili disponibili", icon: "building" },
  { href: "/zones", label: "Zone immobiliari", icon: "map" },
  { href: "/matching-settings", label: "Regole automatiche", icon: "settings" },
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

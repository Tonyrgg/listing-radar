import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/fonti", label: "Fonti", icon: "building" },
  { href: "/fonti/pratiche", label: "Pratiche e documenti", icon: "scan" },
  { href: "/fonti/corrispondenze", label: "Collegamenti territoriali", icon: "map" },
  { href: "/lifecycle/review", label: "Identità immobili", icon: "scale" },
] as const;

/**
 * Cinque pagine. «Proprietà» non è più qui: l'archivio delle case è una
 * destinazione della barra laterale — Immobili — e ripeterlo dentro Segnali
 * significava avere due archivi con due nomi.
 */
export function LifecycleSectionNav() {
  return (
    <SectionNav items={items} ariaLabel="Sezioni dei segnali" exact={["/fonti", "/fonti/pratiche", "/fonti/corrispondenze", "/lifecycle/review"]} />
  );
}

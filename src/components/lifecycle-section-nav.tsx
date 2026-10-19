import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/intelligence", label: "Archivio", icon: "radar" },
  { href: "/fonti", label: "Fonti", icon: "building" },
  { href: "/lifecycle/review", label: "Corrispondenze da verificare", icon: "scale" },
] as const;

/**
 * Cinque pagine. «Proprietà» non è più qui: l'archivio delle case è una
 * destinazione della barra laterale — Immobili — e ripeterlo dentro Segnali
 * significava avere due archivi con due nomi.
 */
export function LifecycleSectionNav() {
  return (
    <SectionNav items={items} ariaLabel="Sezioni dei segnali" exact={["/lifecycle"]} />
  );
}

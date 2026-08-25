import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/lifecycle", label: "Sintesi", icon: "radar" },
  { href: "/lifecycle/opportunities", label: "Opportunità", icon: "flame" },
  { href: "/lifecycle/private", label: "Privati", icon: "user" },
  { href: "/lifecycle/agencies", label: "Agenzie", icon: "building" },
  { href: "/lifecycle/review", label: "Da decidere", icon: "scale" },
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

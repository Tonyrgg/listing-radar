import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/lifecycle", label: "Sintesi", icon: "radar" },
  { href: "/lifecycle/opportunities", label: "Opportunità", icon: "flame" },
  { href: "/lifecycle/private", label: "Privati", icon: "user" },
  { href: "/lifecycle/agencies", label: "Agenzie", icon: "building" },
  { href: "/lifecycle/archive", label: "Proprietà", icon: "building" },
  { href: "/lifecycle/review", label: "Da decidere", icon: "scale" },
] as const;

/** Prima non esisteva: sei pagine erano raggiungibili solo da un link. */
export function LifecycleSectionNav() {
  return (
    <SectionNav items={items} ariaLabel="Sezioni dei segnali" exact={["/lifecycle"]} />
  );
}

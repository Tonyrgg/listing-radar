import { Building2, Flame, Radar, Scale, UserRound } from "lucide-react";

import { SectionNav } from "@/components/ui/section-nav";

const items = [
  { href: "/lifecycle", label: "Sintesi", icon: Radar },
  { href: "/lifecycle/opportunities", label: "Opportunità", icon: Flame },
  { href: "/lifecycle/private", label: "Privati", icon: UserRound },
  { href: "/lifecycle/agencies", label: "Agenzie", icon: Building2 },
  { href: "/lifecycle/archive", label: "Proprietà", icon: Building2 },
  { href: "/lifecycle/review", label: "Da decidere", icon: Scale },
] as const;

/** Prima non esisteva: sei pagine erano raggiungibili solo da un link. */
export function LifecycleSectionNav() {
  return (
    <SectionNav items={items} ariaLabel="Sezioni dei segnali" exact={["/lifecycle"]} />
  );
}

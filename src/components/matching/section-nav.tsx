import Link from "next/link";
import {
  Building2,
  MapPinned,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";

const items = [
  ["/matching", "Panoramica", Sparkles],
  ["/requests", "Richieste clienti", UsersRound],
  ["/portfolio", "Immobili disponibili", Building2],
  ["/zones", "Zone di Bitonto", MapPinned],
  ["/matching-settings", "Regole automatiche", Settings2],
] as const;

export function MatchingSectionNav() {
  return (
    <nav
      aria-label="Sezioni richieste e matching"
      className="flex gap-1 overflow-x-auto border-b border-[var(--line-soft)] pb-2"
    >
      {items.map(([href, label, Icon]) => (
        <Link
          key={href}
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[7px] px-3 text-sm font-semibold text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--surface-accent)]"
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

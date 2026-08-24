"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  Building2,
  Flame,
  Gauge,
  MapPinned,
  Radar,
  Scale,
  ScanSearch,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";

const icons = {
  building: Building2,
  flame: Flame,
  gauge: Gauge,
  map: MapPinned,
  radar: Radar,
  scale: Scale,
  scan: ScanSearch,
  settings: Settings2,
  user: UserRound,
  users: UsersRound,
} as const;

export type SectionNavIcon = keyof typeof icons;

export type SectionNavItem = {
  href: string;
  label: string;
  icon: SectionNavIcon;
};

/**
 * Navigazione di sezione. Unica implementazione per Commerciale e Segnali:
 * nessuna sotto-pagina resta raggiungibile solo da un link dentro il testo.
 */
export function SectionNav({
  items,
  ariaLabel,
  exact = [],
}: Readonly<{
  items: readonly SectionNavItem[];
  ariaLabel: string;
  /** Percorsi che devono combaciare esattamente, senza prefisso. */
  exact?: readonly string[];
}>) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto pb-0.5"
    >
      {items.map((item) => {
        const Icon = icons[item.icon];
        const active = exact.includes(item.href)
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "inline-flex min-h-[var(--lr-control-height-compact)] shrink-0 items-center gap-2 rounded-[var(--lr-radius-control)] px-3",
              "text-[length:var(--lr-text-meta)] font-medium transition-colors",
              active
                ? "bg-[var(--lr-raised)] text-[var(--lr-ink)] shadow-[inset_0_0_0_1px_var(--lr-line)]"
                : "text-[var(--lr-ink-2)] hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
            )}
          >
            <Icon
              aria-hidden="true"
              className={clsx("size-4", active ? "text-[var(--lr-ink)]" : "text-[var(--lr-ink-3)]")}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

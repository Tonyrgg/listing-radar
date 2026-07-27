"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
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
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sezioni richieste e matching"
      className="flex gap-1 overflow-x-auto border-b border-[var(--line-soft)] pb-2"
    >
      {items.map(([href, label, Icon]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[7px] border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--surface-accent)]",
              active
                ? "border-[oklch(0.48_0.055_145)] bg-[oklch(0.23_0.035_145)] text-[var(--surface-accent)]"
                : "border-transparent text-[var(--ink-soft)] hover:border-[var(--line-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
            )}
          >
            <Icon
              aria-hidden="true"
              className={clsx(
                "size-4 transition-colors",
                active
                  ? "text-[var(--surface-accent)]"
                  : "text-[var(--ink-subtle)] group-hover:text-[var(--ink-strong)]",
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

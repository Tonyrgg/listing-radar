"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  Building2,
  CalendarRange,
  Inbox,
  House,
  Settings2,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Inizio", icon: House },
  { href: "/incoming", label: "Da completare", icon: Inbox },
  { href: "/listings", label: "Archivio", icon: Building2 },
  { href: "/reports", label: "Riepiloghi", icon: CalendarRange },
  { href: "/settings", label: "Impostazioni", icon: Settings2 },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex w-full min-w-0 gap-1.5 overflow-x-auto"
      aria-label="Navigazione principale"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-center text-xs font-semibold transition-colors",
              isActive
                ? "bg-[var(--surface-accent)] text-[var(--button-ink)]"
                : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="hidden md:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

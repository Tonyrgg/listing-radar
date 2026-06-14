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
      className="grid w-full min-w-0 grid-cols-3 gap-1.5 lg:flex lg:flex-col"
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
              "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md px-2 text-center text-sm font-medium transition-colors lg:justify-start lg:gap-3 lg:px-3 lg:text-left",
              isActive
                ? "bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"
                : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

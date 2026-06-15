"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/incoming", label: "Nuovi arrivi" },
  { href: "/listings", label: "Immobili" },
  { href: "/reports", label: "Report" },
  { href: "/settings", label: "Impostazioni" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex w-full min-w-0 gap-1.5 overflow-x-auto"
      aria-label="Navigazione principale"
    >
      {navItems.map((item) => {
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
                ? "bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"
                : "text-[var(--ink-soft)] hover:text-[var(--ink-strong)]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

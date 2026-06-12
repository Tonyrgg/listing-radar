"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/listings", label: "Annunci" },
  { href: "/reports", label: "Report" },
  { href: "/settings", label: "Settings" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1.5">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-[var(--surface-strong)] text-white"
                : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/incoming", label: "Nuovi arrivi", icon: Inbox },
  { href: "/listings", label: "Annunci", icon: Building2 },
  { href: "/reports", label: "Report", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-full min-w-0 gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
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
              "inline-flex h-11 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
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

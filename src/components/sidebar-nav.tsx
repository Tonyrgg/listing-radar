"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  MapPinned,
  ScanSearch,
  Settings,
  Workflow,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/incoming", label: "Nuovi arrivi", icon: Inbox },
  { href: "/listings", label: "Immobili", icon: Building2 },
  { href: "/map", label: "Mappa Zone", icon: MapPinned },
  { href: "/matching", label: "Richieste e Matching", icon: ScanSearch },
  { href: "/reports", label: "Report", icon: FileText },
  { href: "/property-worker", label: "Property Worker", icon: Workflow },
  { href: "/settings", label: "Impostazioni", icon: Settings },
];

export function SidebarNav({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  const pathname = usePathname();

  return (
    <nav
      className="flex w-full min-w-0 overflow-x-auto lg:block lg:overflow-visible"
      aria-label="Navigazione principale"
    >
      <div className="flex min-w-max gap-1 rounded-[10px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.42)] p-1 lg:min-w-0 lg:flex-col lg:border-0 lg:bg-transparent lg:p-0">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={clsx(
              "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[7px] px-3 text-center text-xs font-semibold transition-colors lg:h-11 lg:w-full lg:justify-start lg:px-3.5 lg:text-[13px]",
              collapsed && "lg:justify-center lg:px-0",
              isActive
                ? "bg-[var(--surface-panel)] text-[var(--ink-strong)] shadow-[inset_0_0_0_1px_var(--line-soft)]"
                : "text-[var(--ink-subtle)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5 lg:size-4" />
            <span className={clsx(collapsed && "lg:sr-only")}>{item.label}</span>
          </Link>
        );
      })}
      </div>
    </nav>
  );
}

"use client";

import { clsx } from "clsx";
import {
  Building2,
  ClipboardCheck,
  Crosshair,
  History,
  LayoutDashboard,
  RadioTower,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../lifecycle.module.css";

const items = [
  { href: "/lifecycle", label: "Dashboard", icon: LayoutDashboard },
  { href: "/lifecycle/opportunities", label: "Opportunities", icon: Crosshair },
  { href: "/lifecycle/agencies", label: "Agencies", icon: Building2 },
  { href: "/lifecycle/archive", label: "Archive", icon: History },
  { href: "/lifecycle/review", label: "Review", icon: ClipboardCheck },
  { href: "/lifecycle/private", label: "Private Radar", icon: RadioTower },
];

export function LifecycleNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Navigazione Property Lifecycle">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/lifecycle" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(styles.navLink, active && styles.navLinkActive)}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

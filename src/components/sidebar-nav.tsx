"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Building2, Cog, Inbox, MapPinned, Radar, ScanSearch } from "lucide-react";

/**
 * Cinque destinazioni, più le impostazioni tenute separate in fondo.
 * Ogni sezione porta dentro le proprie sotto-pagine: niente più orfani.
 */
const primaryItems = [
  {
    href: "/dashboard",
    label: "Oggi",
    hint: "Il lavoro aperto",
    icon: Inbox,
    owns: ["/dashboard", "/incoming", "/reports"],
  },
  {
    href: "/listings",
    label: "Immobili",
    hint: "Archivio e schede",
    icon: Building2,
    owns: ["/listings"],
  },
  {
    href: "/lifecycle",
    label: "Segnali",
    hint: "Opportunità e cambi",
    icon: Radar,
    /* Le fonti stanno qui: dicono di chi ti puoi fidare, che è la prima
     * domanda dei segnali. */
    owns: ["/lifecycle", "/fonti"],
  },
  {
    href: "/matching",
    label: "Commerciale",
    hint: "Richieste e immobili",
    icon: ScanSearch,
    owns: ["/matching", "/requests", "/portfolio", "/zones", "/matching-settings"],
  },
  {
    href: "/map",
    label: "Territorio",
    hint: "Aree operative",
    icon: MapPinned,
    owns: ["/map"],
  },
] as const;

const settingsItem = {
  href: "/settings",
  label: "Impostazioni",
  hint: "Fonti e automazioni",
  icon: Cog,
  owns: ["/settings"],
} as const;

function isActive(pathname: string, owns: readonly string[]) {
  return owns.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

function itemClass(active: boolean, collapsed: boolean) {
  return clsx(
    "group inline-flex min-h-[var(--lr-control-height)] shrink-0 items-center gap-2.5 rounded-[var(--lr-radius-control)] px-3",
    "text-[length:var(--lr-text-body)] font-medium transition-colors",
    "lg:w-full lg:justify-start",
    collapsed && "lg:justify-center lg:px-0",
    active
      ? "bg-[var(--lr-ink)] text-[var(--lr-surface)] shadow-[var(--lr-floating)]"
      : "text-[var(--lr-ink-2)] hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
  );
}

export function SidebarNav({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  const pathname = usePathname();

  return (
    <nav
      className="flex w-full min-w-0 flex-col gap-1 overflow-x-auto lg:overflow-visible"
      aria-label="Navigazione principale"
    >
      <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.owns);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? `${item.label} — ${item.hint}` : item.label}
              aria-current={active ? "page" : undefined}
              className={itemClass(active, collapsed)}
            >
              <Icon
                aria-hidden="true"
                className={clsx(
                  "size-4 shrink-0",
                  active ? "text-[var(--lr-accent)]" : "text-[var(--lr-ink-3)]",
                )}
              />
              <span className={clsx("min-w-0", collapsed && "lg:sr-only")}>
                <span className="block truncate leading-tight">{item.label}</span>
                <span className={clsx(
                  "hidden truncate text-[length:var(--lr-text-label)] font-normal lg:block",
                  active ? "text-[var(--lr-accent)]" : "text-[var(--lr-ink-3)]",
                )}>
                  {item.hint}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="hidden lg:mt-2 lg:block lg:border-t lg:border-[var(--lr-line-quiet)] lg:pt-2">
        <SettingsLink collapsed={collapsed} pathname={pathname} />
      </div>
      <div className="lg:hidden">
        <SettingsLink collapsed={false} pathname={pathname} />
      </div>
    </nav>
  );
}

function SettingsLink({
  collapsed,
  pathname,
}: Readonly<{ collapsed: boolean; pathname: string }>) {
  const Icon = settingsItem.icon;
  const active = isActive(pathname, settingsItem.owns);

  return (
    <Link
      href={settingsItem.href}
      title={settingsItem.label}
      aria-current={active ? "page" : undefined}
      className={itemClass(active, collapsed)}
    >
      <Icon
        aria-hidden="true"
        className={clsx("size-4 shrink-0", active ? "text-[var(--lr-accent)]" : "text-[var(--lr-ink-3)]")}
      />
      <span className={clsx(collapsed && "lg:sr-only")}>{settingsItem.label}</span>
    </Link>
  );
}

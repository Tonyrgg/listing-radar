import { MONITORED_ZONE } from "@/lib/constants";
import { SidebarNav } from "@/components/sidebar-nav";
import { Bell, CirclePlus, LogOut, Radar, Search, UserRound } from "lucide-react";
import { logout } from "@/app/login/actions";
import { isAuthRequired } from "@/lib/auth";

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[oklch(0.18_0.02_164_/_0.92)] backdrop-blur-xl">
        <div className="flex min-h-16 w-full items-center gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-[190px] items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-[var(--surface-accent)] text-[var(--button-ink)]">
              <Radar aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-5 text-[var(--ink-strong)]">
                Listing Radar
              </p>
              <p className="truncate text-[11px] font-medium text-[var(--ink-subtle)]">
                Zona {MONITORED_ZONE}
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <SidebarNav />
          </div>

          <div className="hidden h-10 min-w-[230px] items-center gap-2 rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--ink-subtle)] xl:flex">
            <Search aria-hidden="true" className="size-4" />
            <span>Cerca immobile, zona, fonte...</span>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <a
              href="/incoming"
              className="hidden size-10 items-center justify-center rounded-md bg-[var(--surface-accent)] text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] sm:inline-flex"
              aria-label="Nuovo arrivo"
            >
              <CirclePlus aria-hidden="true" className="size-5" />
            </a>
            <a
              href="/settings"
              className="hidden size-10 items-center justify-center rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink-strong)] sm:inline-flex"
              aria-label="Notifiche"
            >
              <Bell aria-hidden="true" className="size-5" />
            </a>
            <span className="flex size-10 items-center justify-center rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] text-[var(--surface-accent)]">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
          </div>

          {isAuthRequired() ? (
            <form action={logout} className="shrink-0">
              <button type="submit" className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] text-[var(--ink-soft)] hover:text-[var(--ink-strong)]">
                <LogOut aria-hidden="true" className="size-4" />
                <span className="sr-only">Esci</span>
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <main id="main-content" className="min-w-0 w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}

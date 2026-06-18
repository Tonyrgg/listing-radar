import { MONITORED_ZONE } from "@/lib/constants";
import { SidebarNav } from "@/components/sidebar-nav";
import { LogOut, Radar } from "lucide-react";
import { logout } from "@/app/login/actions";
import { isAuthRequired } from "@/lib/auth";

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--surface-accent)] text-[var(--button-ink)]">
        <Radar aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-4 tracking-[-0.01em] text-[var(--ink-strong)]">
          Listing Radar
        </p>
        <p className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
          Zona {MONITORED_ZONE}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] px-4 py-5 lg:flex lg:flex-col">
        {brand}

        <div className="mt-8 min-h-0 flex-1">
          <SidebarNav />
        </div>

        {isAuthRequired() ? (
          <form action={logout} className="mt-6">
            <button type="submit" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]">
              <LogOut aria-hidden="true" className="size-4" />
              Esci
            </button>
          </form>
        ) : null}
      </aside>

      <div className="min-w-0">
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[oklch(0.155_0.012_160_/_0.94)] backdrop-blur-xl lg:hidden">
        <div className="flex min-h-16 w-full items-center gap-5 px-5 sm:px-7 lg:px-8">
          <div className="flex min-w-[190px] items-center gap-3">
            {brand}
          </div>

          <div className="min-w-0 flex-1">
            <SidebarNav />
          </div>

          {isAuthRequired() ? (
            <form action={logout} className="ml-auto shrink-0">
              <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]">
                <LogOut aria-hidden="true" className="size-4" />
                Esci
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <main id="main-content" className="min-w-0 w-full px-5 py-5 sm:px-7 lg:px-8">
        <div className="w-full">{children}</div>
      </main>
      </div>
    </div>
  );
}

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
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[oklch(0.18_0.018_154_/_0.94)] backdrop-blur-xl">
        <div className="flex min-h-14 w-full items-center gap-5 px-5 sm:px-7 lg:px-8">
          <div className="flex min-w-[178px] items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[6px] bg-[var(--surface-accent)] text-[var(--button-ink)] shadow-[0_8px_18px_oklch(0.1_0.05_150_/_0.2)]">
              <Radar aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-4 text-[var(--ink-strong)]">
                Listing Radar
              </p>
              <p className="truncate text-[10px] font-medium text-[var(--ink-subtle)]">
                Zona {MONITORED_ZONE}
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <SidebarNav />
          </div>

          {isAuthRequired() ? (
            <form action={logout} className="ml-auto shrink-0">
              <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 text-xs font-medium text-[var(--ink-soft)] shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink-strong)]">
                <LogOut aria-hidden="true" className="size-4" />
                Esci
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <main id="main-content" className="min-w-0 w-full px-5 py-6 sm:px-7 lg:px-8">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}

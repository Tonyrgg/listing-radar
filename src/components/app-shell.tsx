import { MONITORED_ZONE } from "@/lib/constants";
import { SidebarNav } from "@/components/sidebar-nav";

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[var(--surface-canvas)]">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="min-w-0 overflow-hidden border-b border-[var(--line-soft)] bg-[var(--surface-panel)] px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                Listing Radar
              </p>
              <h1 className="mt-2 text-xl font-semibold text-[var(--ink-strong)]">
                CRM privato
              </h1>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">{MONITORED_ZONE}</p>
            </div>
          </div>
          <div className="mt-5 lg:mt-8">
            <SidebarNav />
          </div>
        </aside>

        <main id="main-content" className="min-w-0 w-full flex-1 overflow-hidden px-4 py-5 sm:px-6 lg:px-8 lg:py-7 xl:px-10">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}

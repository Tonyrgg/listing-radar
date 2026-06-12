import { MONITORED_ZONE } from "@/lib/constants";
import { SidebarNav } from "@/components/sidebar-nav";

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[var(--surface-canvas)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col lg:flex-row">
        <aside className="border-b border-[var(--line-soft)] bg-[var(--surface-panel)] px-5 py-5 lg:w-72 lg:border-b-0 lg:border-r">
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
          <div className="mt-6">
            <SidebarNav />
          </div>
        </aside>

        <main className="flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

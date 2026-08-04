"use client";

import { clsx } from "clsx";
import { LogOut, PanelLeftClose, PanelLeftOpen, Radar } from "lucide-react";
import { useEffect, useState } from "react";

import { logout } from "@/app/login/actions";
import { PendingSubmitButton } from "@/components/loading-controls";
import { SidebarNav } from "@/components/sidebar-nav";
import { QuickRequestButton, QuickRequestDrawer } from "@/components/matching/quick-request";
import { MONITORED_ZONE } from "@/lib/constants";

function Brand({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  return (
    <div className={clsx("flex items-center gap-3", collapsed && "lg:justify-center")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface-accent)] text-[var(--button-ink)]">
        <Radar aria-hidden="true" className="size-5" />
      </span>
      <div className={clsx("min-w-0", collapsed && "lg:sr-only")}>
        <p className="text-sm font-semibold leading-4 tracking-[-0.01em] text-[var(--ink-strong)]">
          Listing Radar
        </p>
        <p className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
          Zona {MONITORED_ZONE}
        </p>
      </div>
    </div>
  );
}

export function AppShellFrame({
  children,
  showLogout,
}: Readonly<{
  children: React.ReactNode;
  showLogout: boolean;
}>) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem("listing-radar-sidebar") === "collapsed");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(
        "listing-radar-sidebar",
        next ? "collapsed" : "expanded",
      );
      return next;
    });
  }

  return (
    <div
      className={clsx(
        "min-h-screen lg:grid",
        collapsed ? "lg:grid-cols-[74px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={clsx(
          "sticky top-0 hidden h-screen border-r border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] px-4 py-5 lg:flex lg:flex-col",
          collapsed && "lg:px-3",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <Brand collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Apri sidebar" : "Chiudi sidebar"}
            title={collapsed ? "Apri sidebar" : "Chiudi sidebar"}
            className={clsx(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-[7px] border border-[var(--line-soft)] text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
              collapsed && "lg:mx-auto",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>

        <div className="mt-8 min-h-0 flex-1">
          <QuickRequestButton
            compact={collapsed}
            className={clsx("mb-4 w-full", collapsed && "px-0")}
          />
          <SidebarNav collapsed={collapsed} />
        </div>

        {showLogout ? (
          <form action={logout} className="mt-6">
            <PendingSubmitButton
              type="submit"
              pendingLabel={collapsed ? "" : "Esco"}
              icon={<LogOut aria-hidden="true" className="size-4" />}
              aria-label="Esci"
              title="Esci"
              className={clsx(
                "inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
                collapsed && "px-0",
              )}
            >
              <span className={clsx(collapsed && "lg:sr-only")}>Esci</span>
            </PendingSubmitButton>
          </form>
        ) : null}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[oklch(0.155_0.012_160_/_0.94)] backdrop-blur-xl lg:hidden">
          <div className="flex min-h-16 w-full items-center gap-2 px-4 sm:gap-5 sm:px-7 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 sm:min-w-[190px]">
              <Brand />
            </div>

            <div className="min-w-0 flex-1">
              <SidebarNav />
            </div>
            <QuickRequestButton compact className="shrink-0 px-3" />

            {showLogout ? (
              <form action={logout} className="ml-auto shrink-0">
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Esco"
                  icon={<LogOut aria-hidden="true" className="size-4" />}
                  className="inline-flex size-9 items-center justify-center gap-2 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-0 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] sm:h-9 sm:w-auto sm:px-3"
                >
                  <span className="sr-only sm:not-sr-only">Esci</span>
                </PendingSubmitButton>
              </form>
            ) : null}
          </div>
        </header>

        <main id="main-content" className="min-w-0 w-full px-5 py-5 sm:px-7 lg:px-8">
          <div className="w-full">{children}</div>
        </main>
      </div>
      <QuickRequestDrawer />
    </div>
  );
}

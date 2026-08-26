"use client";

import { clsx } from "clsx";
import { LogOut, PanelLeftClose, PanelLeftOpen, Radar } from "lucide-react";
import { useEffect, useState } from "react";

import { logout } from "@/app/login/actions";
import { PendingSubmitButton } from "@/components/loading-controls";
import { CercaGlobale } from "@/components/global-search";
import { SidebarNav } from "@/components/sidebar-nav";
import { QuickRequestButton, QuickRequestDrawer } from "@/components/matching/quick-request";
import { FlashToast } from "@/components/ui/feedback";
import { GlobalActionLoader } from "@/components/ui/global-action-loader";
import { buttonClass } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MONITORED_ZONE } from "@/lib/constants";
import type { Flash } from "@/lib/flash-shared";

function Brand({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  return (
    <div className={clsx("flex items-center gap-2.5", collapsed && "lg:justify-center")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] text-[var(--lr-accent-ink)]">
        <Radar aria-hidden="true" className="size-5" />
      </span>
      <div className={clsx("min-w-0", collapsed && "lg:sr-only")}>
        <p className="font-display text-[length:var(--lr-text-section)] leading-tight text-[var(--lr-ink)]">
          Listing Radar
        </p>
        <p className="truncate text-[length:var(--lr-text-label)] font-medium uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          {MONITORED_ZONE}
        </p>
      </div>
    </div>
  );
}

export function AppShellFrame({
  children,
  showLogout,
  flash,
}: Readonly<{
  children: React.ReactNode;
  showLogout: boolean;
  flash: Flash | null;
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
      window.localStorage.setItem("listing-radar-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  return (
    <div
      className={clsx(
        "min-h-screen lg:grid",
        collapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[252px_minmax(0,1fr)]",
      )}
    >
      <GlobalActionLoader />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[220] focus:rounded-[var(--lr-radius-control)] focus:border focus:border-[var(--lr-line)] focus:bg-[var(--lr-surface)] focus:px-3 focus:py-2 focus:text-[var(--lr-ink)]"
      >
        Vai al contenuto
      </a>

      <aside
        className={clsx(
          "sticky top-0 hidden h-screen border-r border-[var(--lr-line-quiet)] bg-[var(--lr-surface)] px-3 py-4 lg:flex lg:flex-col",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Brand collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Apri la barra laterale" : "Chiudi la barra laterale"}
            title={collapsed ? "Apri la barra laterale" : "Chiudi la barra laterale"}
            className={clsx(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--lr-radius-control)] text-[var(--lr-ink-3)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
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

        <div className="mt-6 min-h-0 flex-1">
          <QuickRequestButton compact={collapsed} className={clsx("mb-3 w-full", collapsed && "px-0")} />
          {/* La ricerca sta sopra le sezioni: si cerca prima di scegliere dove. */}
          <CercaGlobale collapsed={collapsed} className="mb-4" />
          <SidebarNav collapsed={collapsed} />
        </div>

        <div className="mt-4 space-y-2 border-t border-[var(--lr-line-quiet)] pt-3">
          <ThemeToggle compact={collapsed} />
          {showLogout ? (
            <form action={logout}>
              <PendingSubmitButton
                type="submit"
                pendingLabel={collapsed ? "" : "Esco"}
                icon={<LogOut aria-hidden="true" className="size-4" />}
                aria-label="Esci"
                title="Esci"
                className={clsx(buttonClass("quiet", { compact: true, block: true }), collapsed && "px-0")}
              >
                <span className={clsx(collapsed && "lg:sr-only")}>Esci</span>
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-[var(--lr-line-quiet)] bg-[var(--lr-surface)] lg:hidden">
          <div className="flex min-h-14 w-full items-center justify-between gap-3 px-4">
            <Brand />
            <div className="flex shrink-0 items-center gap-2">
              <QuickRequestButton compact />
              {showLogout ? (
                <form action={logout}>
                  <PendingSubmitButton
                    type="submit"
                    pendingLabel=""
                    icon={<LogOut aria-hidden="true" className="size-4" />}
                    aria-label="Esci"
                    className={buttonClass("quiet", { compact: true, icon: true })}
                  >
                    <span className="sr-only">Esci</span>
                  </PendingSubmitButton>
                </form>
              ) : null}
            </div>
          </div>
          {/* Su telefono le sezioni scorrono in orizzontale: senza `min-w-0`
            * il contenitore prende la larghezza della fila e a scorrere è
            * l'intera pagina. */}
          <div className="min-w-0 space-y-2 border-t border-[var(--lr-line-quiet)] px-2 py-2">
            <CercaGlobale />
            <SidebarNav />
          </div>
        </header>

        <main id="main-content" className="min-w-0 w-full px-4 py-5 sm:px-6 lg:px-8">
          <div className="w-full">{children}</div>
        </main>
      </div>

      <QuickRequestDrawer />
      <FlashToast flash={flash} />
    </div>
  );
}

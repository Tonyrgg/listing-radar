"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { clsx } from "clsx";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "listing-radar-theme";

const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "system", label: "Come il sistema", icon: Monitor },
  { value: "light", label: "Chiaro", icon: Sun },
  { value: "dark", label: "Scuro", icon: Moon },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
    return;
  }

  root.setAttribute("data-theme", theme);
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle({ compact = false }: Readonly<{ compact?: boolean }>) {
  /* Lo script di avvio nel documento ha già applicato il tema salvato:
   * qui il controllo si limita a leggerlo, senza un secondo render. */
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  const choose = useCallback((next: Theme) => {
    applyTheme(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Se lo spazio locale è bloccato, il tema resta valido per questa sessione. */
    }

    for (const listener of listeners) listener();
  }, []);

  return (
    <div
      role="group"
      aria-label="Aspetto dell'interfaccia"
      className={clsx(
        "grid grid-cols-3 gap-1 rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] p-1",
        compact && "lg:grid-cols-1",
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            className={clsx(
              "inline-flex min-h-8 items-center justify-center rounded-[3px] transition-colors",
              active
                ? "bg-[var(--lr-raised)] text-[var(--lr-ink)]"
                : "text-[var(--lr-ink-3)] hover:text-[var(--lr-ink)]",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Applica il tema salvato prima del primo pixel, così non c'è sfarfallio.
 * Va inserito nel documento come script inline.
 */
export const themeBootstrapScript = `
try {
  var t = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

"use client";

import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { clsx } from "clsx";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "listing-radar-theme";

const options: Array<{ value: Theme; label: string; note: string; icon: typeof Sun }> = [
  { value: "system", label: "Automatico", note: "Segue il dispositivo", icon: Monitor },
  { value: "light", label: "Chiaro", note: "Per ambienti luminosi", icon: Sun },
  { value: "dark", label: "Scuro", note: "Per lavorare con poca luce", icon: Moon },
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
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = options.find((option) => option.value === theme) ?? options[0]!;
  const SelectedIcon = selected.icon;

  const choose = useCallback((next: Theme) => {
    applyTheme(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Se lo spazio locale è bloccato, il tema resta valido per questa sessione. */
    }

    for (const listener of listeners) listener();
    detailsRef.current?.removeAttribute("open");
  }, []);

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        className={clsx(
          "flex min-h-[var(--lr-control-height)] cursor-pointer list-none items-center gap-2 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-3 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)] transition-colors",
          "hover:bg-[var(--lr-raised)] [&::-webkit-details-marker]:hidden",
          compact && "px-2.5",
        )}
        aria-label={`Tema: ${selected.label}`}
      >
        <SelectedIcon aria-hidden="true" className="size-4 text-[var(--lr-ink-2)]" />
        <span className={clsx(compact && "sr-only")}>{selected.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={clsx("size-4 text-[var(--lr-ink-3)] transition-transform group-open:rotate-180", compact && "hidden")}
        />
      </summary>

      <div
        role="group"
        aria-label="Aspetto dell'interfaccia"
        className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-[var(--lr-radius-card)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-2 shadow-[var(--lr-floating)]"
      >
        <p className="px-2 pb-2 pt-1 text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          Aspetto
        </p>
        {options.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              aria-pressed={active}
              className={clsx(
                "flex min-h-14 w-full items-center gap-3 rounded-[var(--lr-radius-control)] px-2.5 text-left transition-colors",
                active ? "bg-[var(--lr-raised)]" : "hover:bg-[var(--lr-raised)]",
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-surface)] text-[var(--lr-ink-2)]">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">
                  {option.label}
                </span>
                <span className="block text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
                  {option.note}
                </span>
              </span>
              {active ? <Check aria-hidden="true" className="size-4 text-[var(--lr-accent)]" /> : null}
            </button>
          );
        })}
      </div>
    </details>
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

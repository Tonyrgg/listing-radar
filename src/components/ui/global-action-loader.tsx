"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Feedback di sicurezza per le azioni che non hanno gia' un loader proprio.
 * I bottoni con una logica di attesa esplicita possono usare
 * `data-no-global-loader` e restano la fonte di verita' del loro stato.
 */
export function GlobalActionLoader() {
  const pathname = usePathname();
  const [pending, setPending] = useState<{ message: string; pathname: string } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      setPending(null);
    }

    function show(label: string) {
      if (timer) clearTimeout(timer);
      setPending({ message: label, pathname });
      timer = setTimeout(clear, 1800);
    }

    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>("button, a");
      if (!control || control.dataset.noGlobalLoader !== undefined) return;
      if (control instanceof HTMLButtonElement && control.disabled) return;
      if (control instanceof HTMLAnchorElement) {
        if (control.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      }
      const text = (control.getAttribute("aria-label") || control.textContent || "Operazione").trim();
      show(text ? `${text.slice(0, 52)} in corso` : "Operazione in corso");
    }

    function onSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.dataset.noGlobalLoader !== undefined) return;
      show("Salvataggio in corso");
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  if (!pending || pending.pathname !== pathname) return null;

  return (
    <div className="lr-action-loader" role="status" aria-live="polite">
      <LoaderCircle aria-hidden="true" className="size-4" />
      {pending.message}
    </div>
  );
}

import { Search } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

import { controlClass } from "@/components/ui/primitives";

/**
 * La ricerca che sta in ogni pagina.
 *
 * Ogni sezione aveva la sua casella e cercava solo dentro di sé: per trovare
 * «via Piepoli» bisognava già sapere in quale sezione vivesse. Questa è un
 * modulo normale che porta a `/cerca`: funziona anche senza JavaScript, e non
 * ha bisogno di sapere in che pagina ti trovi.
 */
export function CercaGlobale({
  collapsed = false,
  className,
}: Readonly<{ collapsed?: boolean; className?: string }>) {
  if (collapsed) {
    return (
      <Link
        href="/cerca"
        aria-label="Cerca in tutto"
        title="Cerca in tutto"
        className={clsx(
          "inline-flex min-h-[var(--lr-control-height)] w-full items-center justify-center rounded-[var(--lr-radius-control)]",
          "text-[var(--lr-ink-2)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
          className,
        )}
      >
        <Search aria-hidden="true" className="size-4" />
      </Link>
    );
  }

  return (
    <form action="/cerca" role="search" className={clsx("relative block", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lr-ink-3)]"
      />
      <label className="sr-only" htmlFor="cerca-ovunque">
        Cerca case, clienti e zone
      </label>
      <input
        id="cerca-ovunque"
        type="search"
        name="q"
        placeholder="Cerca in tutto…"
        autoComplete="off"
        className={controlClass(undefined, { conIcona: true })}
      />
    </form>
  );
}

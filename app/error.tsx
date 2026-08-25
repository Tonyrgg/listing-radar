"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { buttonClass } from "@/components/ui/primitives";

export default function AppError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error("Errore non gestito nell'interfaccia", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--lr-canvas)] px-4 py-10">
      <div className="w-full max-w-lg rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--lr-danger)]"
          />
          <AlertTriangle aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--lr-danger)]" />
          <div className="min-w-0">
            <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-danger)]">
              Qualcosa si è interrotto
            </p>
            <h1 className="mt-2 text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              Non sono riuscito a mostrare questa pagina
            </h1>
            <p className="mt-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Nessun dato è andato perso: l&apos;errore riguarda solo la
              visualizzazione. Riprova; se succede di nuovo, torna al lavoro
              aperto e riapri la pagina da lì.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
                Riferimento tecnico: {error.digest}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className={buttonClass("primary")}
              >
                Riprova
              </button>
              <a
                href="/dashboard"
                className={buttonClass("secondary")}
              >
                Torna al lavoro aperto
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

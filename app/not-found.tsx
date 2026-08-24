import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--lr-canvas)] px-4 py-10">
      <div className="w-full max-w-lg rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--lr-info)]"
          />
          <Compass aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--lr-info)]" />
          <div className="min-w-0">
            <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
              Pagina non trovata
            </p>
            <h1 className="mt-2 text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              Qui non c&apos;è niente
            </h1>
            <p className="mt-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              L&apos;indirizzo non corrisponde a nessuna sezione. Può succedere
              se un annuncio è stato archiviato o se il collegamento è vecchio.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="inline-flex min-h-[var(--lr-control-height)] items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border border-transparent bg-[var(--lr-accent)] px-4 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-accent-ink)] transition-colors hover:bg-[var(--lr-accent-hover)]"
              >
                Vai al lavoro aperto
              </Link>
              <Link
                href="/listings"
                className="inline-flex min-h-[var(--lr-control-height)] items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)] transition-colors hover:bg-[var(--lr-raised)]"
              >
                Cerca nell&apos;archivio
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

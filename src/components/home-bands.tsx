import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, Chip, EmptyState, Label, Meta, Stripe, buttonClass } from "@/components/ui/primitives";
import { Fonte } from "@/components/ui/atoms";
import type { SourcesSummary } from "@/lib/sources-health";

/**
 * Le quattro fasce della home, una sotto l'altra, ognuna a piena larghezza.
 *
 * L'ordine ha una ragione: prima quanto puoi fidarti di quello che stai per
 * leggere, poi cosa è cambiato senza di te, poi cosa chiede il tuo lavoro,
 * poi il giudizio.
 */

export function Banda({
  numero,
  titolo,
  conteggio,
  azione,
  children,
}: Readonly<{
  numero: number;
  titolo: string;
  conteggio?: ReactNode;
  azione?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <Card as="section">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--lr-line-quiet)] px-4 py-3">
        <div className="min-w-0">
          <Label>Fascia {numero}</Label>
          <h2 className="mt-1 text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
            {titolo}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conteggio}
          {azione}
        </div>
      </div>
      {children}
    </Card>
  );
}

/**
 * La striscia della fiducia: sottile quando va tutto bene, aperta quando no.
 * Sta in cima perché qualifica tutto quello che c'è sotto.
 */
export function StrisciaFiducia({ sources }: Readonly<{ sources: SourcesSummary }>) {
  if (!sources.available) {
    return null;
  }

  const rotte = sources.broken.length;
  const parziali = sources.partial.length;

  if (rotte === 0 && parziali === 0) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Chip tone="neutral" dot>
            Tutte e {sources.total} le fonti lette
          </Chip>
          <Meta>Quello che leggi oggi è completo.</Meta>
        </div>
        <Link href="/fonti" className={buttonClass("quiet", { compact: true })}>
          Vedi le fonti
        </Link>
      </Card>
    );
  }

  const nomi = [...sources.broken, ...sources.partial]
    .map((source) => (source.note ? `${source.name} — ${source.note}` : source.name))
    .join(" · ");

  return (
    <Card className="p-4" floating={false}>
      <div className="flex gap-3">
        <Stripe tone={rotte ? "danger" : "warn"} />
        <div className="min-w-0 flex-1">
          <Label tone={rotte ? "danger" : "warn"}>Quello che leggi oggi è incompleto</Label>
          <p className="mt-1.5 text-[length:var(--lr-text-record)] font-[650] leading-snug text-[var(--lr-ink)]">
            {rotte
              ? `${rotte === 1 ? "Una fonte" : `${rotte} fonti`} su ${sources.total} non ${rotte === 1 ? "è stata letta" : "sono state lette"}`
              : `${parziali} ${parziali === 1 ? "fonte letta" : "fonti lette"} solo in parte`}
          </p>
          <p className="mt-1 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
            {nomi}.
            {sources.unreadListings > 0
              ? ` I ${sources.unreadListings} immobili che teneva restano come li abbiamo visti l'ultima volta: nessuno è stato dichiarato sparito.`
              : " Nessun immobile è stato dichiarato sparito per questo."}
          </p>
          <div className="mt-3">
            <Link href="/fonti" className={buttonClass("secondary", { compact: true })}>
              Vedi tutte le fonti
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Una riga di movimento: cosa è successo, a quale casa, quando. */
export function RigaMovimento({
  titolo,
  dettaglio,
  quando,
  href,
  tone = "neutral",
}: Readonly<{
  titolo: string;
  dettaglio: string;
  quando: string;
  href: string;
  tone?: "neutral" | "warn" | "info";
}>) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-4 py-2.5 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]"
    >
      <Stripe tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
          {titolo}
        </span>
        <span className="block truncate text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {dettaglio}
        </span>
      </span>
      <span className="shrink-0 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        {quando}
      </span>
    </Link>
  );
}

export function FasciaVuota({
  titolo,
  descrizione,
  azione,
}: Readonly<{ titolo: string; descrizione: string; azione?: ReactNode }>) {
  return <EmptyState title={titolo} description={descrizione} action={azione} />;
}

export { Fonte };

import { Card, Scheletro, ScheletroIntestazione } from "@/components/ui/primitives";

/**
 * L'attesa dei Segnali: le quattro cifre in cima, e le due colonne — cosa si
 * è mosso, cosa conviene guardare — nelle proporzioni vere.
 */
export default function SegnaliInAttesa() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Sto caricando i segnali">
      <ScheletroIntestazione />

      <Card className="flex flex-wrap divide-x divide-[var(--lr-line-quiet)]">
        {[0, 1, 2, 3].map((cifra) => (
          <div key={cifra} className="min-w-0 px-4 py-3">
            <Scheletro className="h-7 w-16" />
            <Scheletro className="mt-2 h-3 w-24" />
          </div>
        ))}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          {[0, 1, 2, 3, 4, 5].map((riga) => (
            <div
              key={riga}
              className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-3 py-2.5 first:border-t-0"
            >
              <Scheletro className="h-14 w-20 shrink-0 rounded-[var(--lr-radius-control)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Scheletro className="h-4 w-48 max-w-full" />
                <Scheletro className="h-3 w-64 max-w-full" />
              </div>
            </div>
          ))}
        </Card>
        <Card>
          {[0, 1, 2].map((riga) => (
            <div
              key={riga}
              className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0"
            >
              <Scheletro className="h-16 w-24 shrink-0 rounded-[var(--lr-radius-control)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Scheletro className="h-3 w-24" />
                <Scheletro className="h-4 w-40 max-w-full" />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

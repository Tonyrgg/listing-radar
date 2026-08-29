"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";

import { formatCurrency, formatDate, formatNumber } from "@/lib/formatting";
import {
  claimKeyLabel,
  extractionMethodLabel,
  lifecycleEventLabel,
} from "@/lib/property-lifecycle/read-models/presentation";

/**
 * Cosa le è successo, una riga per volta.
 *
 * Le date stavano in colonna, i fatti pure, ma la provenienza no: leggevi
 * «uscita confermata» senza sapere se l'aveva vista un annuncio o l'aveva
 * dedotta il sistema. Adesso ogni riga porta quattro cose sempre negli stessi
 * posti — quando, quanto è certo, cosa, da dove — e la colonna della certezza
 * è un pallino: pieno se qualcuno l'ha visto, tratteggiato se l'abbiamo deciso
 * noi.
 */

export type EventoDiVita = Readonly<{
  id: string;
  eventType: string;
  occurredAt: string;
  confidence: number;
  actorType: string;
  payload: Record<string, unknown>;
}>;

export type ProvaConservata = Readonly<{
  id: string;
  claimKey: string;
  extractionMethod: string;
  confidence: number;
  observedAt: string;
  sourceRecordedAt: string | null;
}>;

const PREZZO = new Set(["PRICE_DROP", "PRICE_INCREASE", "PRICE_CHANGED"]);
const AGENZIE = new Set([
  "NEW_LISTING",
  "PUBLICATION_REMOVED",
  "PUBLICATION_REAPPEARED",
  "PUBLICATION_RELAUNCHED",
  "DISAPPEARED_CONFIRMED",
  "AGENCY_SWITCH_DETECTED",
  "AGENCY_TO_PRIVATE",
  "SOURCE_MARKED_SOLD",
]);

const FILTRI = [
  { id: "tutto", label: "Tutto" },
  { id: "prezzo", label: "Prezzo" },
  { id: "agenzie", label: "Agenzie" },
  { id: "confermato", label: "Solo confermato" },
] as const;

type Filtro = (typeof FILTRI)[number]["id"];

/** Chi ce l'ha detto: la stessa domanda per ogni riga, la stessa risposta breve. */
function provenienza(evento: EventoDiVita) {
  if (evento.actorType === "USER") return "registrato da una persona";

  return evento.confidence >= 0.85 ? "letta dall'annuncio" : "dedotto dal sistema";
}

function confermato(evento: EventoDiVita) {
  return evento.actorType === "USER" || evento.confidence >= 0.85;
}

function prezzi(payload: Record<string, unknown>) {
  const vecchio = typeof payload.oldPrice === "number" ? payload.oldPrice : null;
  const nuovo = typeof payload.newPrice === "number" ? payload.newPrice : null;

  return vecchio != null && nuovo != null ? { vecchio, nuovo } : null;
}

function Riga({ evento }: Readonly<{ evento: EventoDiVita }>) {
  const movimento = prezzi(evento.payload);
  const certo = confermato(evento);

  return (
    <li className="grid grid-cols-[auto_18px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[6rem_18px_minmax(0,1fr)_auto]">
      <time
        dateTime={evento.occurredAt}
        className="font-mono text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]"
      >
        {formatDate(evento.occurredAt)}
      </time>

      {/* Pieno se qualcuno l'ha visto, tratteggiato se l'abbiamo dedotto noi. */}
      <span aria-hidden="true" className="grid h-[1.2em] place-items-center">
        <span
          className={clsx(
            "size-2 rounded-full",
            certo
              ? "bg-[var(--lr-accent)]"
              : "border border-dashed border-[var(--lr-ink-3)]",
          )}
        />
      </span>

      <p className="min-w-0 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
        {movimento ? (
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <b className="font-[650]">
              {movimento.nuovo < movimento.vecchio ? "↓ −" : "↑ +"}
              {formatCurrency(Math.abs(movimento.nuovo - movimento.vecchio))}
            </b>
            <span className="text-[var(--lr-ink-2)]">
              {formatCurrency(movimento.vecchio)} → {formatCurrency(movimento.nuovo)}
            </span>
            {movimento.vecchio ? (
              <span className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                {formatNumber(
                  Math.round(
                    ((movimento.nuovo - movimento.vecchio) / movimento.vecchio) * 1000,
                  ) / 10,
                )}
                %
              </span>
            ) : null}
          </span>
        ) : (
          lifecycleEventLabel(evento.eventType)
        )}
      </p>

      <span className="col-start-3 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)] sm:col-start-4 sm:text-right">
        {provenienza(evento)}
      </span>
    </li>
  );
}

export function RigaDiVita({
  eventi,
  prove,
}: Readonly<{ eventi: readonly EventoDiVita[]; prove: readonly ProvaConservata[] }>) {
  const [filtro, setFiltro] = useState<Filtro>("tutto");

  const visibili = useMemo(
    () =>
      eventi.filter((evento) => {
        if (filtro === "prezzo") return PREZZO.has(evento.eventType);
        if (filtro === "agenzie") return AGENZIE.has(evento.eventType);
        if (filtro === "confermato") return confermato(evento);

        return true;
      }),
    [eventi, filtro],
  );

  return (
    <section className="overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--lr-line-quiet)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[length:var(--lr-text-record)] font-[650] leading-tight text-[var(--lr-ink)]">
            Riga di vita
          </h2>
          <p className="mt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            ogni riga è un fatto osservato, non una nostra opinione
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Cosa mostrare della riga di vita"
          className="flex shrink-0 flex-wrap gap-1 rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] p-1"
        >
          {FILTRI.map((voce) => (
            <button
              key={voce.id}
              type="button"
              role="tab"
              aria-selected={filtro === voce.id}
              onClick={() => setFiltro(voce.id)}
              className={clsx(
                "min-h-8 rounded-[var(--lr-radius-control)] px-2.5 text-[length:var(--lr-text-meta)] transition-colors",
                filtro === voce.id
                  ? "bg-[var(--lr-surface)] font-[650] text-[var(--lr-ink)]"
                  : "text-[var(--lr-ink-2)] hover:text-[var(--lr-ink)]",
              )}
            >
              {voce.label}
            </button>
          ))}
        </div>
      </header>

      {visibili.length ? (
        <ol className="divide-y divide-[var(--lr-line-quiet)] px-4">
          {visibili.map((evento) => (
            <Riga key={evento.id} evento={evento} />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-center text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {eventi.length
            ? "Nessun fatto di questo tipo: prova a togliere il filtro."
            : "Non le è ancora successo niente: la casa è appena entrata nell'archivio."}
        </p>
      )}

      <details className="group border-t border-[var(--lr-line-quiet)]">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]">
          <span>Il tratteggio è nostro: la fonte non lo dichiarava.</span>
          <span className="text-[var(--lr-ink-2)] group-open:text-[var(--lr-ink)]">
            {prove.length
              ? `Mostra le ${formatNumber(prove.length)} prove conservate`
              : "Nessuna prova conservata"}
          </span>
        </summary>

        {prove.length ? (
          <ul className="divide-y divide-[var(--lr-line-quiet)] border-t border-[var(--lr-line-quiet)] px-4">
            {prove.map((prova) => (
              <li
                key={prova.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                  {claimKeyLabel(prova.claimKey)}
                </span>
                <span className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                  {formatDate(prova.sourceRecordedAt ?? prova.observedAt)},{" "}
                  {extractionMethodLabel(prova.extractionMethod)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}

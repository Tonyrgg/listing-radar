"use client";

import { ArrowUpDown, Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import clsx from "clsx";

import { setPropertyElevatorAction } from "@/app/(private)/matching-actions";
import { Card, CardHeader, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/formatting";
import type { PropertyElevatorState } from "@/lib/matching/elevator";

/**
 * Il rilievo dell'ascensore.
 *
 * Gli incarichi arrivano dal gestionale, che l'ascensore non lo dice: il
 * portafoglio non aveva quel dato su nessuna scheda. Con la regola
 * dell'ascensore un dato mancante vale «no», quindi ogni cliente che pretende
 * l'ascensore non vedeva niente. Chiederlo casa per casa dentro il form
 * dell'immobile vuol dire aprire e salvare sessanta schede intere.
 *
 * Qui la domanda e' una sola e si risponde dove si legge, senza cambiare
 * pagina: c'e', non c'e', non lo so. La lista non si riordina sotto le dita —
 * la riga risposta resta dov'e' con la sua risposta in chiaro, cosi' si vede
 * cosa si e' appena detto e si puo' correggere subito.
 */

export type RilievoAscensore = Readonly<{
  id: string;
  nome: string;
  piano: number | null;
  tipologia: string;
  zona: string | null;
  stato: PropertyElevatorState;
}>;

const RISPOSTE: ReadonlyArray<{ valore: boolean | null; etichetta: string; stato: PropertyElevatorState; icona: typeof Check }> = [
  { valore: true, etichetta: "C'è", stato: "present", icona: Check },
  { valore: false, etichetta: "Non c'è", stato: "absent", icona: X },
  { valore: null, etichetta: "Non lo so", stato: "undeclared", icona: Minus },
];

function dove(immobile: RilievoAscensore) {
  return [
    immobile.piano == null ? "piano non indicato" : `piano ${formatNumber(immobile.piano)}`,
    immobile.tipologia,
    immobile.zona,
  ].filter(Boolean).join(" · ");
}

export function ElevatorSurvey({
  immobili,
}: Readonly<{ immobili: readonly RilievoAscensore[] }>) {
  const [risposte, setRisposte] = useState<Record<string, PropertyElevatorState>>({});
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState("");
  const [, startTransition] = useTransition();

  const statoDi = (immobile: RilievoAscensore) => risposte[immobile.id] ?? immobile.stato;
  const daRilevare = immobili.filter((immobile) => statoDi(immobile) === "undeclared").length;

  function rispondi(immobile: RilievoAscensore, valore: boolean | null) {
    const precedente = statoDi(immobile);
    const nuovo: PropertyElevatorState = valore === true ? "present" : valore === false ? "absent" : "undeclared";
    if (nuovo === precedente) return;
    setErrore("");
    setInCorso(immobile.id);
    setRisposte((corrente) => ({ ...corrente, [immobile.id]: nuovo }));
    startTransition(async () => {
      try {
        await setPropertyElevatorAction(immobile.id, valore);
      } catch (motivo) {
        setRisposte((corrente) => ({ ...corrente, [immobile.id]: precedente }));
        setErrore(motivo instanceof Error ? motivo.message : "Risposta non registrata.");
      } finally {
        setInCorso(null);
      }
    });
  }

  if (!immobili.length) {
    return (
      <Card>
        <EmptyState
          title="Non c'è niente da rilevare"
          description="Ogni immobile dove l'ascensore conta ha già la sua risposta. I piani terra non compaiono: lì l'ascensore non serve."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="L'ascensore, casa per casa"
        meta={daRilevare
          ? `${formatNumber(daRilevare)} da rilevare su ${formatNumber(immobili.length)}. Ogni risposta ricalcola subito gli abbinamenti di quell'immobile.`
          : `Tutti rilevati: ${formatNumber(immobili.length)} immobili. Una risposta si può cambiare quando vuoi.`}
      />

      {errore ? (
        <p role="alert" className="border-b border-[var(--lr-line-quiet)] bg-[var(--lr-danger-soft)] px-4 py-2 text-[length:var(--lr-text-body)] text-[var(--lr-danger)]">
          {errore}
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--lr-line-quiet)]">
        {immobili.map((immobile) => {
          const stato = statoDi(immobile);
          return (
            <li
              key={immobile.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)]">
                  <ArrowUpDown aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
                  <Link
                    href={`/portfolio/${immobile.id}`}
                    className="truncate rounded-[var(--lr-radius-control)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]"
                  >
                    {immobile.nome}
                  </Link>
                </p>
                <Meta className="mt-0.5">{dove(immobile)}</Meta>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Finche' il salvataggio e' in volo la riga lo dice: una
                  * risposta data non e' ancora una risposta registrata, e
                  * chiudere la pagina in quel mezzo secondo la perderebbe. */}
                {inCorso === immobile.id ? (
                  <Chip tone="info">salvo…</Chip>
                ) : stato === "undeclared" ? (
                  <Chip tone="warn">da rilevare</Chip>
                ) : (
                  <Chip tone={stato === "present" ? "ok" : "neutral"}>
                    {stato === "present" ? "con ascensore" : "senza ascensore"}
                  </Chip>
                )}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Ascensore di ${immobile.nome}`}>
                  {RISPOSTE.map((risposta) => {
                    const scelta = risposta.stato === stato;
                    const Icona = risposta.icona;
                    return (
                      <button
                        key={risposta.etichetta}
                        type="button"
                        aria-pressed={scelta}
                        disabled={inCorso === immobile.id}
                        onClick={() => rispondi(immobile, risposta.valore)}
                        className={clsx(
                          buttonClass(scelta ? "primary" : "secondary", { compact: true }),
                          "gap-1.5",
                        )}
                      >
                        <Icona aria-hidden="true" className="size-3.5" />
                        {risposta.etichetta}
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

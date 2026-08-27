import { Movimento } from "@/components/ui/atoms";
import { formatCurrency } from "@/lib/formatting";
import {
  agencyListingStateLabel,
  humanize,
} from "@/lib/property-lifecycle/read-models/presentation";

/* ---------------------------------------------------------------------------
 * Cosa dire di un movimento, oltre al suo nome.
 *
 * La riga compatta e la scheda fotografica raccontano lo stesso fatto in due
 * densità diverse: se il modo di leggere il payload vive in due copie, una
 * delle due prima o poi resta indietro. È già successo — l'esito post-uscita
 * arrivava a schermo come «Off market no sale evidence» in un posto e tradotto
 * nell'altro.
 * ------------------------------------------------------------------------- */

/** Il prezzo che si muove: la freccia dice tutto prima delle parole. */
export function MovimentoDiPrezzo({
  payload,
  sinceClassName,
}: Readonly<{
  payload: Record<string, unknown>;
  /** Dove lo spazio manca, «di quanto è sceso» conta più di «a quanto è arrivato». */
  sinceClassName?: string;
}>) {
  const vecchio = typeof payload.oldPrice === "number" ? payload.oldPrice : null;
  const nuovo = typeof payload.newPrice === "number" ? payload.newPrice : null;
  if (vecchio == null || nuovo == null) return null;

  const delta = nuovo - vecchio;

  return (
    <Movimento
      direction={delta === 0 ? "flat" : delta < 0 ? "down" : "up"}
      amount={`${delta < 0 ? "−" : "+"}${formatCurrency(Math.abs(delta))}`}
      since={formatCurrency(nuovo)}
      sinceClassName={sinceClassName}
    />
  );
}

/** Vero quando il payload contiene davvero un prezzo che si è mosso. */
export function haMovimentoDiPrezzo(payload: Record<string, unknown>) {
  return typeof payload.oldPrice === "number" && typeof payload.newPrice === "number";
}

/**
 * Il contorno del fatto, dove non c'è un prezzo che si muove.
 *
 * `outcome` porta uno stato del mandato d'agenzia: passa dal suo dizionario,
 * non da `humanize`, altrimenti la costante del database arriva a schermo
 * tradotta a metà.
 */
export function contornoDelMovimento(payload: Record<string, unknown>): string | null {
  const esito = typeof payload.outcome === "string" ? payload.outcome : null;
  if (esito) return agencyListingStateLabel(esito);

  const precedente =
    typeof payload.priorAgencyState === "string" ? payload.priorAgencyState : null;
  if (precedente) return `prima: ${agencyListingStateLabel(precedente).toLocaleLowerCase("it")}`;

  const motivo = typeof payload.reason === "string" ? payload.reason : null;
  if (motivo) return humanize(motivo);

  return null;
}

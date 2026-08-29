/**
 * Quanto siamo sicuri di dove sta una casa, tradotto in cosa si disegna.
 *
 * La regola è una sola e non ammette vie di mezzo: lo spillo si mette dove
 * l'immobile lo conosciamo davvero, l'area quando conosciamo la via ma non il
 * civico, e quando non sappiamo niente non si disegna niente. Una mappa che
 * mostra un punto inventato è peggio di nessuna mappa: sembra una risposta.
 */

export type FormaPosizione = "spillo" | "area" | "niente";

export type PosizioneCasa = Readonly<{
  latitude: number | null;
  longitude: number | null;
  precision: string;
  manuallyVerified?: boolean;
}>;

/** Il raggio dell'incertezza, in metri: quanto larga è la nostra ignoranza. */
const RAGGIO = { STREET_ONLY: 130, APPROXIMATE_AREA: 350 } as const;

/** Più stretto è quello che sappiamo, più vicino si guarda. */
const ZOOM = { spillo: 17, STREET_ONLY: 16, APPROXIMATE_AREA: 14 } as const;

export function formaPosizione(posizione: PosizioneCasa | null): FormaPosizione {
  if (!posizione || posizione.latitude == null || posizione.longitude == null) {
    return "niente";
  }

  /* Una posizione confermata a mano vale quanto un indirizzo esatto: qualcuno
   * l'ha guardata e ha detto «è qui». */
  if (posizione.manuallyVerified || posizione.precision === "EXACT_ADDRESS") {
    return "spillo";
  }

  return posizione.precision === "STREET_ONLY" ||
    posizione.precision === "APPROXIMATE_AREA"
    ? "area"
    : "niente";
}

export function raggioPosizione(precision: string) {
  return RAGGIO[precision as keyof typeof RAGGIO] ?? RAGGIO.APPROXIMATE_AREA;
}

export function zoomPosizione(forma: FormaPosizione, precision: string) {
  if (forma === "spillo") return ZOOM.spillo;

  return ZOOM[precision as keyof typeof ZOOM] ?? ZOOM.APPROXIMATE_AREA;
}

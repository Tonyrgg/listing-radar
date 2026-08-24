/**
 * Palette dei dati disegnati sulla mappa.
 *
 * Leaflet dipinge su canvas e SVG con valori espliciti, dove le variabili CSS
 * non arrivano: questo file è l'unico posto in cui quei valori possono vivere.
 * Restano allineati ai token `--lr-data-*` di src/styles/tokens.css.
 *
 * Regola: qui il colore distingue categorie, non indica l'azione successiva.
 * Ogni tinta va sempre accompagnata da un'etichetta o da un tratto diverso,
 * così lo stato non dipende dal solo colore.
 */

export const MAP_DATA_COLORS = {
  info: "#4f9de0",
  positive: "#57b98a",
  attention: "#dda63f",
  critical: "#e0705e",
  accentuated: "#9a8ad4",
  muted: "#8b968f",
} as const;

/** Fondo e inchiostro delle etichette disegnate sopra la mappa. */
export const MAP_INK = {
  onColor: "#0e1411",
  halo: "#f1f4ef",
} as const;

export type MapDataColor = keyof typeof MAP_DATA_COLORS;

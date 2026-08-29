"use client";

import { useMemo } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";

import { MAP_DATA_COLORS, MAP_INK } from "@/lib/design/map-palette";
import {
  formaPosizione,
  raggioPosizione,
  zoomPosizione,
  type PosizioneCasa,
} from "@/lib/map/posizione-casa";

/**
 * Il pezzo di mappa dentro la scheda di una casa.
 *
 * Non è la mappa dell'archivio in piccolo: qui non si disegna, non si
 * seleziona, non si sposta niente. Si guarda dove sta la casa e si torna su.
 * La rotellina resta libera di scorrere la pagina — una mappa alta cinque
 * centimetri che cattura lo scroll è una trappola.
 */

/* Leaflet cerca le sue icone come file accanto al CSS, e con il bundler quei
 * file non ci sono: lo spillo è un SVG scritto qui, così non dipende da niente. */
function spillo() {
  return L.divIcon({
    className: "",
    iconSize: [22, 30],
    iconAnchor: [11, 29],
    html: `<svg viewBox="0 0 22 30" width="22" height="30" aria-hidden="true">
      <path d="M11 29C11 29 20 17.8 20 11A9 9 0 0 0 2 11c0 6.8 9 18 9 18Z"
        fill="${MAP_DATA_COLORS.positive}" stroke="${MAP_INK.halo}" stroke-width="2"/>
      <circle cx="11" cy="11" r="3.4" fill="${MAP_INK.onColor}"/>
    </svg>`,
  });
}

export function MappaDellaCasaCanvas({
  posizione,
  etichetta,
}: Readonly<{ posizione: PosizioneCasa; etichetta: string }>) {
  const forma = formaPosizione(posizione);
  const icona = useMemo(() => (forma === "spillo" ? spillo() : null), [forma]);

  if (forma === "niente") return null;

  const centro: [number, number] = [posizione.latitude!, posizione.longitude!];

  return (
    <MapContainer
      center={centro}
      zoom={zoomPosizione(forma, posizione.precision)}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      zoomControl={false}
      keyboard={false}
      className="h-40 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)]"
      style={{ zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {forma === "spillo" && icona ? (
        <Marker position={centro} icon={icona} alt={etichetta} interactive={false} />
      ) : (
        /* L'area non è una casa grande: è il perimetro entro cui la casa sta.
         * Tratteggiata, perché il confine non l'ha dichiarato nessuno. */
        <Circle
          center={centro}
          radius={raggioPosizione(posizione.precision)}
          interactive={false}
          pathOptions={{
            color: MAP_DATA_COLORS.info,
            fillColor: MAP_DATA_COLORS.info,
            fillOpacity: 0.16,
            weight: 2,
            dashArray: "5 4",
          }}
        />
      )}
    </MapContainer>
  );
}

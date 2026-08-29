"use client";

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";

import { formaPosizione, type PosizioneCasa } from "@/lib/map/posizione-casa";

/**
 * Leaflet tocca `window` appena viene importato: la mappa entra solo nel
 * browser, e finché non è arrivata al suo posto resta un riquadro della stessa
 * altezza, così la scheda non salta.
 */
const Canvas = dynamic(
  () => import("./mappa-della-casa-canvas").then((m) => m.MappaDellaCasaCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        <MapPinned aria-hidden="true" className="size-4" />
        Carico la mappa…
      </div>
    ),
  },
);

export function MappaDellaCasa({
  posizione,
  etichetta,
}: Readonly<{ posizione: PosizioneCasa; etichetta: string }>) {
  if (formaPosizione(posizione) === "niente") return null;

  return <Canvas posizione={posizione} etichetta={etichetta} />;
}

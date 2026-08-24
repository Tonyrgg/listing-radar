import type { Metadata } from "next";

import { MapClient } from "@/components/map/MapClient";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Territorio",
};

export default function MapPage() {
  return (
    <div className="space-y-4">
      {/* Prima il titolo viveva dentro una barra flottante sopra la mappa:
        * era l'unica pagina in cui non si capiva dove ci si trovava. */}
      <PageHeader
        eyebrow="Territorio"
        title="Aree operative"
        description="Aree, strade e segnaposti del lavoro sul campo. Disegna un perimetro, segna un contatto utile e tieni traccia di cosa è già stato battuto."
      />
      <MapClient />
    </div>
  );
}

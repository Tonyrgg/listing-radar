import {
  Card,
  ScheletroFiltri,
  ScheletroIntestazione,
  ScheletroRiga,
} from "@/components/ui/primitives";

/**
 * L'attesa dell'archivio ricalca l'archivio: una barra di filtri e una lista
 * di righe con la foto. Prima erano quattro riquadri staccati alti 144 px, e
 * all'arrivo dei dati la pagina saltava.
 */
export default function ArchivioInAttesa() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Sto caricando l'archivio">
      <ScheletroIntestazione />
      <ScheletroFiltri quanti={3} />
      <Card>
        {[0, 1, 2, 3, 4].map((riga) => (
          <ScheletroRiga key={riga} />
        ))}
      </Card>
    </div>
  );
}

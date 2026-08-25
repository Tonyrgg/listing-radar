import { Card, ScheletroIntestazione, ScheletroRiga } from "@/components/ui/primitives";

/**
 * L'attesa di una pagina qualsiasi dell'area privata.
 *
 * Mostrava tre riquadri affiancati e un blocco alto 320 px: una forma che non
 * appartiene a nessuna pagina del prodotto. Quasi tutte, adesso, sono
 * un'intestazione e un elenco di righe con la foto.
 */
export default function PaginaInAttesa() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Sto caricando la pagina">
      <ScheletroIntestazione />
      <Card>
        {[0, 1, 2, 3].map((riga) => (
          <ScheletroRiga key={riga} />
        ))}
      </Card>
    </div>
  );
}

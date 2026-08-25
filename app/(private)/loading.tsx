import {
  Card,
  Scheletro,
  ScheletroFiltri,
  ScheletroIntestazione,
  ScheletroRiga,
} from "@/components/ui/primitives";

/** Il cambio pagina conserva la struttura del lavoro, non mostra una tela vuota. */
export default function PrivateLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Caricamento della pagina">
      <ScheletroIntestazione />
      <ScheletroFiltri quanti={3} />
      <Card>
        <ScheletroRiga />
        <ScheletroRiga />
        <ScheletroRiga />
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Scheletro className="h-28 rounded-[var(--lr-radius-container)]" />
        <Scheletro className="h-28 rounded-[var(--lr-radius-container)]" />
        <Scheletro className="h-28 rounded-[var(--lr-radius-container)]" />
      </div>
    </div>
  );
}

import { PageHeader } from "@/components/page-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { MatchingSettingsEditor } from "@/components/matching/management-panels";
import { getMatchingConfig, listFeatures } from "@/lib/matching/repository";

export default async function MatchingSettingsPage() {
  const [features, config] = await Promise.all([listFeatures(), getMatchingConfig()]);
  return <div className="space-y-5"><PageHeader eyebrow="Configurazione controllata" title="Criteri di matching" description="Pesi, soglie e feature restano modificabili senza cambiare il codice. Dopo una modifica avvia un nuovo ricalcolo." /><MatchingSectionNav /><MatchingSettingsEditor features={features} config={config} /></div>;
}

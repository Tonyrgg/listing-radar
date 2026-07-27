import { MatchingRulesShowroom } from "@/components/matching/rules-showroom";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { PageHeader } from "@/components/page-header";
import {
  getMatchingConfig,
  listFeatures,
} from "@/lib/matching/repository";

export default async function MatchingSettingsPage() {
  const [features, config] = await Promise.all([
    listFeatures(),
    getMatchingConfig(),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Regole automatiche"
        title="Come decide Listing Radar"
        description="Scegli quali caratteristiche contano e quanto devono influire. Le modifiche valgono dal prossimo ricalcolo."
      />
      <MatchingSectionNav />
      <MatchingRulesShowroom features={features} config={config} />
    </div>
  );
}

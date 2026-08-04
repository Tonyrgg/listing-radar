import { MatchingRulesShowroom } from "@/components/matching/rules-showroom";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
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
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Regole automatiche"
        title="Regole di matching"
        description="Soglie, tolleranze e pesi usati per ordinare gli abbinamenti."
      />
      <MatchingSectionNav />
      <MatchingRulesShowroom features={features} config={config} />
    </div>
  );
}

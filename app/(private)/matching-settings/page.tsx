import { MatchingRulesShowroom } from "@/components/matching/rules-showroom";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import {
  getMatchingConfig,
  listFeatures,
} from "@/lib/matching/repository";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Regole di matching" };

export default async function MatchingSettingsPage() {
  const [features, config] = await Promise.all([
    listFeatures(),
    getMatchingConfig(),
  ]);
  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Regole di matching"
        description="Soglie, tolleranze e pesi usati per ordinare gli abbinamenti."
      />
      <MatchingRulesShowroom features={features} config={config} />
    </div>
  );
}

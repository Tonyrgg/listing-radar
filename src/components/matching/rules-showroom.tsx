"use client";

import { Gauge, Ruler, Save, WalletCards } from "lucide-react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveFeatureAction, saveMatchingConfigAction } from "@/app/(private)/matching-actions";
import type { FeatureDefinition, MatchingConfig } from "@/lib/matching/types";
import styles from "./section-design.module.css";
import { FeatureMark } from "./visual-language";

export function MatchingRulesShowroom({ features, config }: Readonly<{ features: FeatureDefinition[]; config: MatchingConfig }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const categories = features.reduce((result, feature) => {
    (result[feature.category] ??= []).push(feature);
    return result;
  }, {} as Record<string, FeatureDefinition[]>);

  function saveConfig(formData: FormData) {
    start(async () => {
      await saveMatchingConfigAction({
        thresholds: {
          compatible: Number(formData.get("compatible")),
          almostCompatible: Number(formData.get("almost")),
          weak: Number(formData.get("weak")),
        },
        budgetTolerance: {
          near: Number(formData.get("near")) / 100,
          weak: Number(formData.get("toleranceWeak")) / 100,
        },
        commercialSqm: {
          minimumFactor: Number(formData.get("sqmMin")),
          maximumFactor: Number(formData.get("sqmMax")),
        },
      });
      router.refresh();
    });
  }

  return (
    <div className={styles.featureGroups}>
      <form action={saveConfig} className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Parametri generali</p>
            <h2 className={styles.panelTitle}>Soglie e tolleranze</h2>
            <p className={styles.panelDescription}>Le modifiche saranno usate dal prossimo ricalcolo.</p>
          </div>
          <button className={styles.primaryButton} disabled={pending}><Save aria-hidden="true" className="size-4" /> {pending ? "Salvataggio…" : "Salva regole"}</button>
        </header>
        <div className={styles.ruleGrid}>
          <RuleGroup icon={Gauge} title="Qualità risultato" fields={[
            ["compatible", "Compatibile da", config.thresholds.compatible],
            ["almost", "Buona alternativa da", config.thresholds.almostCompatible],
            ["weak", "Da valutare da", config.thresholds.weak],
          ]} />
          <RuleGroup icon={WalletCards} title="Tolleranza prezzo" fields={[
            ["near", "Tolleranza piccola %", config.budgetTolerance.near * 100],
            ["toleranceWeak", "Tolleranza massima %", config.budgetTolerance.weak * 100],
          ]} />
          <RuleGroup icon={Ruler} title="Metri commerciali" fields={[
            ["sqmMin", "Coefficiente minimo", config.commercialSqm.minimumFactor],
            ["sqmMax", "Coefficiente massimo", config.commercialSqm.maximumFactor],
          ]} />
        </div>
      </form>

      {Object.entries(categories).map(([category, categoryFeatures]) => {
        /* Se tutte le caratteristiche di un gruppo valgono per le stesse cose,
         * scriverlo su ogni riga non distingue: si dice una volta, in cima. */
        const ambiti = new Set(categoryFeatures.map((feature) => feature.applies_to));
        const ambitoComune = ambiti.size === 1 ? [...ambiti][0] : null;

        return (
        <section key={category}>
          <header className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className={styles.sectionEyebrow}>
                {ambitoComune ? ambitoLabel(ambitoComune) : "Caratteristiche"}
              </p>
              <h2 className={`${styles.panelTitle} capitalize`}>{category}</h2>
            </div>
            <span className={styles.count}>
              {categoryFeatures.length} {categoryFeatures.length === 1 ? "regola" : "regole"}
            </span>
          </header>
          <div className={styles.featureRows}>
            {categoryFeatures.map((feature) => (
              <form
                className={styles.featureRow}
                key={feature.id}
                action={(formData) => start(async () => {
                  await saveFeatureAction({
                    id: feature.id,
                    key: feature.key,
                    label: formData.get("label"),
                    category: feature.category,
                    field_type: feature.field_type,
                    applies_to: feature.applies_to,
                    default_weight: Number(formData.get("weight")),
                    is_active: formData.get("active") === "on",
                    sort_order: feature.sort_order,
                  });
                  router.refresh();
                })}
              >
                <div className={styles.featureIdentity}>
                  <div className="flex items-center gap-3">
                    <FeatureMark featureKey={feature.key} label={feature.label} />
                    <div>
                      <p className="text-sm font-semibold text-[var(--lr-ink)]">{feature.label}</p>
                      {ambitoComune ? null : (
                        <p className={styles.muted}>{ambitoLabel(feature.applies_to)}</p>
                      )}
                    </div>
                  </div>
                  <label className={styles.activeToggle}><input name="active" type="checkbox" defaultChecked={feature.is_active} /> Attiva</label>
                </div>
                <div className={styles.featureControls}>
                  <label className={styles.field}>Nome mostrato<input className={styles.input} name="label" defaultValue={feature.label} /></label>
                  <label className={styles.field}>Peso<input className={styles.input} name="weight" type="number" min="0" max="30" defaultValue={feature.default_weight} /></label>
                  <button className={styles.iconButton} aria-label={`Salva ${feature.label}`}><Save aria-hidden="true" className="size-4" /></button>
                </div>
              </form>
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}

/** Su cosa agisce una caratteristica, detto per esteso. */
function ambitoLabel(appliesTo: string) {
  if (appliesTo === "request") return "Solo sulle richieste";
  if (appliesTo === "property") return "Solo sugli immobili";

  return "Su richieste e immobili";
}

function RuleGroup({ icon: Icon, title, fields }: Readonly<{ icon: typeof Gauge; title: string; fields: Array<[string, string, number]> }>) {
  return (
    <section className={styles.ruleGroup}>
      <h3 className={styles.ruleTitle}><Icon aria-hidden="true" className="size-4 text-[var(--lr-accent)]" /> {title}</h3>
      <div className={styles.ruleFields}>
        {fields.map(([name, label, value]) => (
          <label className={styles.numberField} key={name}>{label}<input className={styles.input} name={name} type="number" step="any" defaultValue={value} /></label>
        ))}
      </div>
    </section>
  );
}

"use client";

import { Gauge, Ruler, Save, Settings2, WalletCards } from "lucide-react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  saveFeatureAction,
  saveMatchingConfigAction,
} from "@/app/(private)/matching-actions";
import type {
  FeatureDefinition,
  MatchingConfig,
} from "@/lib/matching/types";
import { FeatureMark } from "./visual-language";

const inputClass =
  "h-11 w-full rounded-[7px] border border-[var(--line-strong)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-strong)] outline-none focus:border-[var(--surface-accent)]";

export function MatchingRulesShowroom({
  features,
  config,
}: Readonly<{
  features: FeatureDefinition[];
  config: MatchingConfig;
}>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const categories = features.reduce(
    (result, feature) => {
      (result[feature.category] ??= []).push(feature);
      return result;
    },
    {} as Record<string, FeatureDefinition[]>,
  );

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
    <div className="space-y-7">
      <form
        action={saveConfig}
        className="overflow-hidden rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line-soft)] px-5 py-4">
          <span className="grid size-10 place-items-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
            <Gauge aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-[var(--ink-strong)]">
              Quanto deve essere forte un abbinamento?
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              Questi valori regolano il risultato, senza nascondere le
              alternative.
            </p>
          </div>
        </div>
        <div className="grid gap-px bg-[var(--line-soft)] md:grid-cols-3">
          <RuleGroup
            icon={Gauge}
            title="Qualità del risultato"
            fields={[
              ["compatible", "Compatibile da", config.thresholds.compatible],
              [
                "almost",
                "Buona alternativa da",
                config.thresholds.almostCompatible,
              ],
              ["weak", "Da valutare da", config.thresholds.weak],
            ]}
          />
          <RuleGroup
            icon={WalletCards}
            title="Flessibilità sul prezzo"
            fields={[
              [
                "near",
                "Tolleranza piccola %",
                config.budgetTolerance.near * 100,
              ],
              [
                "toleranceWeak",
                "Tolleranza massima %",
                config.budgetTolerance.weak * 100,
              ],
            ]}
          />
          <RuleGroup
            icon={Ruler}
            title="Stima metri commerciali"
            fields={[
              [
                "sqmMin",
                "Coefficiente minimo",
                config.commercialSqm.minimumFactor,
              ],
              [
                "sqmMax",
                "Coefficiente massimo",
                config.commercialSqm.maximumFactor,
              ],
            ]}
          />
        </div>
        <div className="flex justify-end border-t border-[var(--line-soft)] px-5 py-4">
          <button className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">
            <Save className="size-4" />
            {pending ? "Salvataggio…" : "Salva regole generali"}
          </button>
        </div>
      </form>

      {Object.entries(categories).map(([category, categoryFeatures]) => (
        <section key={category}>
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="size-4 text-[var(--surface-accent)]" />
            <h2 className="text-sm font-bold capitalize text-[var(--ink-strong)]">
              {category}
            </h2>
            <span className="text-xs text-[var(--ink-subtle)]">
              {categoryFeatures.length} caratteristiche
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categoryFeatures.map((feature) => (
              <form
                key={feature.id}
                action={(formData) =>
                  start(async () => {
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
                  })
                }
                className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 transition-colors hover:border-[var(--line-strong)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <FeatureMark
                    featureKey={feature.key}
                    label={feature.label}
                  />
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={feature.is_active}
                    />
                    Disponibile
                  </label>
                </div>
                <label className="mt-4 grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">
                  Nome mostrato
                  <input
                    name="label"
                    defaultValue={feature.label}
                    className={inputClass}
                  />
                </label>
                <div className="mt-3 flex items-end gap-3">
                  <label className="grid flex-1 gap-1 text-xs font-semibold text-[var(--ink-soft)]">
                    Importanza
                    <input
                      name="weight"
                      type="number"
                      min="0"
                      max="30"
                      defaultValue={feature.default_weight}
                      className={inputClass}
                    />
                  </label>
                  <button className="grid size-11 shrink-0 place-items-center rounded-[8px] border border-[var(--line-strong)] text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]">
                    <Save
                      aria-label={`Salva ${feature.label}`}
                      className="size-4"
                    />
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RuleGroup({
  icon: Icon,
  title,
  fields,
}: Readonly<{
  icon: typeof Gauge;
  title: string;
  fields: Array<[string, string, number]>;
}>) {
  return (
    <div className="bg-[var(--surface-panel)] p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
        <Icon className="size-4 text-[var(--surface-accent)]" />
        {title}
      </p>
      <div className="mt-4 space-y-3">
        {fields.map(([name, label, value]) => (
          <label
            key={name}
            className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-3 text-xs font-semibold text-[var(--ink-soft)]"
          >
            {label}
            <input
              name={name}
              type="number"
              step="any"
              defaultValue={value}
              className={inputClass}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

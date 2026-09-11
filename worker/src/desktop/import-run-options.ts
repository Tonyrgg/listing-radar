import type { PropertyActivityMode } from "../services/property-activities.js";

export type ImportRunOptions = {
  activityMode: PropertyActivityMode;
  importCoOwners: boolean;
  parallelCrmWindows: boolean;
};

type ImportRunOptionSource = Partial<ImportRunOptions> & {
  importOptions?: Partial<ImportRunOptions> | null;
};

const isActivityMode = (value: unknown): value is PropertyActivityMode =>
  value === "direct_contact" || value === "plain" || value === "none";

/**
 * Le scelte dell'ultimo avvio appartengono alla singola acquisizione.
 * I vecchi job non le hanno ancora: in quel caso si ricade sulle preferenze
 * correnti, conservando la compatibilita' con tutte le versioni precedenti.
 */
export function importRunOptions(
  acquisition: ImportRunOptionSource | null | undefined,
  fallback: ImportRunOptions,
): ImportRunOptions {
  const saved = acquisition?.importOptions;
  const legacyActivityMode = acquisition?.activityMode;
  return {
    activityMode: isActivityMode(saved?.activityMode)
      ? saved.activityMode
      : isActivityMode(legacyActivityMode)
        ? legacyActivityMode
        : fallback.activityMode,
    importCoOwners: typeof saved?.importCoOwners === "boolean"
      ? saved.importCoOwners
      : fallback.importCoOwners,
    parallelCrmWindows: typeof saved?.parallelCrmWindows === "boolean"
      ? saved.parallelCrmWindows
      : fallback.parallelCrmWindows,
  };
}

export function withImportRunOptions(
  acquisition: Record<string, unknown> | null | undefined,
  options: ImportRunOptions,
  selectedAt = new Date().toISOString(),
): Record<string, unknown> {
  return {
    ...(acquisition ?? {}),
    importOptions: { ...options, selectedAt },
  };
}

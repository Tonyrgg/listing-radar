import type { PropertyActivityMode } from "../services/property-activities.js";

export type ImportRunOptions = {
  activityMode: PropertyActivityMode;
  importCoOwners: boolean;
  parallelCrmWindows: boolean;
};

type ImportRunOptionSource = Partial<ImportRunOptions> & {
  importOptions?: (Partial<ImportRunOptions> & { selectedAt?: string; lockedAt?: string }) | null;
};

const isActivityMode = (value: unknown): value is PropertyActivityMode =>
  value === "direct_contact" || value === "plain" || value === "killer" || value === "none";

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

/** Blocca le scelte al primo avvio dell'import e conserva il lock ai resume. */
export function withLockedImportRunOptions(
  acquisition: Record<string, unknown> | null | undefined,
  options: ImportRunOptions,
  lockedAt = new Date().toISOString(),
): Record<string, unknown> {
  const existing = (acquisition?.importOptions ?? null) as (Partial<ImportRunOptions> & { selectedAt?: string; lockedAt?: string }) | null;
  if (existing?.lockedAt) return { ...(acquisition ?? {}) };
  return {
    ...withImportRunOptions(acquisition, options, existing?.selectedAt ?? lockedAt),
    importOptions: {
      ...options,
      selectedAt: existing?.selectedAt ?? lockedAt,
      lockedAt,
    },
  };
}

/**
 * Dopo l'avvio il contenuto della run non può cambiare: attività e
 * comproprietari dipendono dai dati raccolti. La concorrenza, invece, è una
 * scelta di esecuzione e può passare in sicurezza da una a due finestre (o
 * viceversa) a ogni ripresa, senza alterare il checkpoint.
 */
export function withResumedImportConcurrency(
  acquisition: Record<string, unknown> | null | undefined,
  parallelCrmWindows: boolean,
): Record<string, unknown> {
  const existing = (acquisition?.importOptions ?? null) as (Partial<ImportRunOptions> & { selectedAt?: string; lockedAt?: string }) | null;
  if (!existing) return { ...(acquisition ?? {}) };
  return {
    ...(acquisition ?? {}),
    importOptions: {
      ...existing,
      parallelCrmWindows,
    },
  };
}

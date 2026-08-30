import type { SourceHealth } from "@/components/ui/atoms";
import { vistaAgenzie } from "@/lib/property-lifecycle/read-models/server";

/**
 * Di quali fonti ci si può fidare stamattina.
 *
 * È la risposta alla quinta domanda del manuale — «dove si è fermata
 * un'automazione» — e serve prima di tutto il resto: senza, una lista più corta
 * sembra un mercato fermo invece di una fonte rotta.
 *
 * Regola non negoziabile del progetto: un crawler fermo non prova la scomparsa
 * di un annuncio. Chi legge questo riepilogo deve vederlo scritto.
 */
export type SourceReading = {
  name: string;
  health: SourceHealth;
  read: number;
  note: string | null;
};

export type SourcesSummary = {
  available: boolean;
  total: number;
  healthy: number;
  broken: SourceReading[];
  partial: SourceReading[];
  /** Immobili non aggiornati perché la loro fonte non è stata letta. */
  unreadListings: number;
};

function classify(health: string | null, syncStatus: string | null): SourceHealth {
  const value = String(health ?? "").toUpperCase();

  if (value === "FAILED" || value === "STRUCTURE_CHANGED") return "broken";
  if (value === "DEGRADED") return "partial";
  if (value === "HEALTHY") return "healthy";

  return syncStatus ? "partial" : "unknown";
}

function noteFor(health: SourceHealth, raw: string | null): string | null {
  const value = String(raw ?? "").toUpperCase();

  if (value === "STRUCTURE_CHANGED") return "il sito ha cambiato struttura";
  if (value === "FAILED") return "non ha risposto";
  if (value === "DEGRADED") return "letta solo in parte";
  if (health === "unknown") return "mai letta";

  return null;
}

export async function getSourcesSummary(): Promise<SourcesSummary> {
  const view = await vistaAgenzie();

  if (!view.available || !view.data) {
    return {
      available: false,
      total: 0,
      healthy: 0,
      broken: [],
      partial: [],
      unreadListings: 0,
    };
  }

  const readings: SourceReading[] = view.data
    .filter((agency) => agency.enabled)
    .map((agency) => {
      const health = classify(agency.latestHealth, agency.latestSyncStatus);

      return {
        name: agency.name,
        health,
        read: agency.latestSyncCounts?.inScope ?? 0,
        note: noteFor(health, agency.latestHealth),
      };
    });

  const broken = readings.filter((reading) => reading.health === "broken");
  const partial = readings.filter((reading) => reading.health === "partial");

  return {
    available: true,
    total: readings.length,
    healthy: readings.filter((reading) => reading.health === "healthy").length,
    broken,
    partial,
    /* Quello che quelle fonti tenevano l'ultima volta che le abbiamo lette:
     * non è sparito, semplicemente oggi non lo abbiamo riletto. */
    unreadListings: broken.reduce((total, reading) => total + reading.read, 0),
  };
}

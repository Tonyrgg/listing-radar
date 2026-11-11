import type { SourceHealth } from "@/components/ui/atoms";
import { vistaAgenzie } from "@/lib/property-lifecycle/read-models/server";
import { classifySourceReading } from './source-reading-quality';

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
  const now = Date.now();

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
      const health = classifySourceReading(agency.latestHealth, agency.latestSyncStatus, agency.latestHealthAt, now);

      return {
        name: agency.name,
        health,
        read: agency.activeCount,
        note: noteFor(health, agency.latestHealth) ?? (health === 'partial' ? 'lettura non recente o aggiornamento incompleto' : null),
      };
    });

  const broken = readings.filter((reading) => reading.health === "broken");
  const partial = readings.filter((reading) => reading.health === "partial" || reading.health === 'unknown');

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

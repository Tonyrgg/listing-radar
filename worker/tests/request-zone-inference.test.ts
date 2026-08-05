import { describe, expect, it } from "vitest";

import type { CrmRequestDetail } from "../src/adapters/crm/requests.js";
import { inferRequestZonePreferences, type RequestInferenceZone } from "../src/services/request-zone-inference.js";

const zones: RequestInferenceZone[] = [
  { id: "one", zone_number: 1, name: "Centro Storico", aliases: [], landmarks: [], associated_streets: [] },
  { id: "two", zone_number: 2, name: "Centro", aliases: [], landmarks: [], associated_streets: [] },
  { id: "three", zone_number: 3, name: "Zona Villa", aliases: ["Villa"], landmarks: ["Villa Comunale"], associated_streets: [] },
  { id: "five", zone_number: 5, name: "Zona Santi Medici", aliases: ["Santi Medici"], landmarks: [], associated_streets: [] },
];

function detail(needs: string, activityDescription: string | null = null): CrmRequestDetail {
  return {
    externalId: "request", title: "Richiesta", url: "https://crm.test/request", status: "In gestione",
    headerFields: {}, fields: { Esigenze: needs }, clientExternalId: null, relatedSections: [], evolutionText: null,
    activities: activityDescription ? [{ externalId: "task", subject: null, mode: null, type: null, status: null, date: null, assignedTo: null, agency: null, description: activityDescription }] : [],
    activityCaptureError: null, capturedAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("inferenza zone richieste dal testo CRM", () => {
  it("riconosce una zona esclusa senza confonderla con il nome più corto", () => {
    expect(inferRequestZonePreferences(detail("NO CENTRO STORICO. Cerca una soluzione piccola"), zones)).toEqual([
      expect.objectContaining({ zone_id: "one", preference_level: "excluded", matched_phrase: "centro storico" }),
    ]);
  });

  it("riconosce più zone desiderate", () => {
    expect(inferRequestZonePreferences(detail("Zona Villa, Santi Medici"), zones).map((item) => [item.zone_id, item.preference_level])).toEqual([
      ["three", "preferred"], ["five", "preferred"],
    ]);
  });

  it("considera anche le descrizioni delle attività passate", () => {
    expect(inferRequestZonePreferences(detail("investimento", "Ha escluso la zona villa"), zones)[0]).toMatchObject({
      zone_id: "three", preference_level: "excluded",
    });
  });

  it("non inventa una zona preferita quando la richiesta indica tutte le zone", () => {
    expect(inferRequestZonePreferences(detail("valuta tutte le zone"), zones)).toEqual([]);
  });

  it("non scambia la tipologia villa per la zona Villa", () => {
    expect(inferRequestZonePreferences(detail("cerca una villa indipendente"), zones)).toEqual([]);
  });
});

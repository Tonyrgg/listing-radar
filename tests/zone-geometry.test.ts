import { describe, expect, it } from "vitest";

import {
  pointInPolygon,
  polygonLabelPoint,
  suggestedZoneIdsForRequest,
  suggestedZonePreferencesForRequest,
  zoneContainingPoint,
} from "@/lib/map/geometry";
import type { InternalZone } from "@/lib/matching/types";

const geometry = {
  type: "Polygon",
  coordinates: [[
    [16.68, 41.10],
    [16.70, 41.10],
    [16.70, 41.12],
    [16.68, 41.12],
    [16.68, 41.10],
  ]],
};

const zone: InternalZone = {
  id: "zone-villa",
  name: "Zona Villa",
  description: null,
  landmarks: ["Villa comunale"],
  aliases: ["Villa"],
  associated_streets: ["Via 4 Novembre"],
  geometry,
  color: "#5fbf7a",
  is_active: true,
};

describe("zone geometry", () => {
  it("recognizes points inside and outside a polygon", () => {
    expect(pointInPolygon({ latitude: 41.11, longitude: 16.69 }, geometry)).toBe(true);
    expect(pointInPolygon({ latitude: 41.13, longitude: 16.69 }, geometry)).toBe(false);
  });

  it("excludes an inner district from a surrounding zone", () => {
    const geometryWithHole = {
      type: "Polygon",
      coordinates: [
        [[16.68, 41.10], [16.70, 41.10], [16.70, 41.12], [16.68, 41.12], [16.68, 41.10]],
        [[16.687, 41.107], [16.693, 41.107], [16.693, 41.113], [16.687, 41.113], [16.687, 41.107]],
      ],
    };

    expect(pointInPolygon({ latitude: 41.105, longitude: 16.685 }, geometryWithHole)).toBe(true);
    expect(pointInPolygon({ latitude: 41.11, longitude: 16.69 }, geometryWithHole)).toBe(false);
  });

  it("places the visual label inside the polygon without changing its geometry", () => {
    const original = JSON.stringify(geometry);
    const labelPoint = polygonLabelPoint(geometry);

    expect(labelPoint).not.toBeNull();
    expect(pointInPolygon(labelPoint!, geometry)).toBe(true);
    expect(JSON.stringify(geometry)).toBe(original);
  });

  it("keeps the visual label outside polygon holes", () => {
    const geometryWithHole = {
      type: "Polygon",
      coordinates: [
        [[16.68, 41.10], [16.70, 41.10], [16.70, 41.12], [16.68, 41.12], [16.68, 41.10]],
        [[16.685, 41.105], [16.695, 41.105], [16.695, 41.115], [16.685, 41.115], [16.685, 41.105]],
      ],
    };
    const labelPoint = polygonLabelPoint(geometryWithHole);

    expect(labelPoint).not.toBeNull();
    expect(pointInPolygon(labelPoint!, geometryWithHole)).toBe(true);
  });

  it("finds the zone that contains a property point", () => {
    expect(zoneContainingPoint([zone], { latitude: 41.11, longitude: 16.69 })?.id).toBe("zone-villa");
  });

  it("suggests zones only from explicit CRM names, aliases or streets", () => {
    expect(suggestedZoneIdsForRequest({
      title: "Richiesta Immobiliare",
      notes: null,
      raw_payload: { fields: { Esigenze: "Preferisce Via 4 Novembre e dintorni" } },
    }, [zone])).toEqual(["zone-villa"]);

    expect(suggestedZoneIdsForRequest({
      title: "Richiesta Immobiliare",
      notes: null,
      raw_payload: { fields: { Esigenze: "Valuta tutta Bitonto" } },
    }, [zone])).toEqual([]);

    expect(suggestedZoneIdsForRequest({
      title: "RR - Villa singola",
      notes: null,
      raw_payload: { fields: { Esigenze: "Cerca una villa indipendente" } },
    }, [zone])).toEqual([]);

    expect(suggestedZoneIdsForRequest({
      title: "Richiesta Immobiliare",
      notes: null,
      raw_payload: { fields: { Esigenze: "Preferisce zona Villa" } },
    }, [zone])).toEqual(["zone-villa"]);

    expect(suggestedZonePreferencesForRequest({
      title: "Richiesta Immobiliare",
      notes: null,
      raw_payload: { fields: { Esigenze: "No zona Villa" } },
    }, [zone])).toEqual([{ zoneId: "zone-villa", preferenceLevel: "excluded" }]);
  });
});

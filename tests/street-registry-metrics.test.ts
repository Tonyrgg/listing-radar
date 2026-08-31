import { describe, expect, it } from "vitest";

import {
  distanceRing,
  rankByDistance,
  streetDistanceMeters,
  streetLengthMeters,
  streetRepresentativePoint,
} from "@/lib/street-registry/metrics";

const line = {
  type: "LineString" as const,
  coordinates: [[16.69, 41.107], [16.692, 41.107]],
};

describe("street registry metrics", () => {
  it("computes length, midpoint and minimum center-to-line distance", () => {
    expect(streetLengthMeters(line)).toBeGreaterThan(160);
    expect(streetLengthMeters(line)).toBeLessThan(170);
    expect(streetRepresentativePoint(line)?.longitude).toBeCloseTo(16.691, 10);
    expect(streetRepresentativePoint(line)?.latitude).toBeCloseTo(41.107, 10);
    expect(streetDistanceMeters({ longitude: 16.691, latitude: 41.107 }, line)).toBeCloseTo(0, 6);
  });

  it("uses deterministic 250 metre rings and tie-breaking ranks", () => {
    expect(distanceRing(0)).toBe(0);
    expect(distanceRing(249.99)).toBe(0);
    expect(distanceRing(250)).toBe(1);
    expect([...rankByDistance([
      { id: "b", distance: 10 },
      { id: "a", distance: 10 },
      { id: "c", distance: null },
    ])]).toEqual([["a", 1], ["b", 2]]);
  });

  it("rejects invalid ring inputs and ignores invalid geometries", () => {
    expect(() => distanceRing(-1)).toThrow("Distanza non valida");
    expect(streetLengthMeters({ type: "LineString", coordinates: [[16.69, 41.1]] })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { listingClusters } from "@/lib/map/listing-clusters";

const pins = Array.from({ length: 7 }, (_, index) => ({
  id: `listing-${index + 1}`,
  title: "Bitonto Ospedale",
  source: "Test",
  url: "https://example.test/listing",
  price: null,
  sqm: null,
  addressRaw: "Via Test 1",
  latitude: 41.107745,
  longitude: 16.689233,
}));

describe("cluster annunci territorio", () => {
  it("mantiene il cluster a zoom basso", () => {
    expect(listingClusters(pins, 16)).toMatchObject([{ listings: pins, displaced: false }]);
  });

  it("separa in punti stabili gli annunci con coordinate identiche a zoom alto", () => {
    const spread = listingClusters(pins, 18);
    expect(spread).toHaveLength(7);
    expect(spread.every((item) => item.listings.length === 1 && item.displaced)).toBe(true);
    expect(new Set(spread.map((item) => `${item.latitude}:${item.longitude}`)).size).toBe(7);
  });
});

import { describe, expect, it } from "vitest";

import {
  extractListingCoordinates,
  normalizeListingCoordinates,
} from "@/lib/listings/coordinates";

describe("listing coordinate extraction", () => {
  it("normalizes explicit latitude and longitude values", () => {
    expect(
      normalizeListingCoordinates({
        latitude: "41.107745",
        longitude: "16.689233",
        source: "test",
      }),
    ).toEqual({
      latitude: 41.107745,
      longitude: 16.689233,
      source: "test",
    });
  });

  it("extracts coordinates from JSON-LD geo objects", () => {
    const coordinates = extractListingCoordinates({
      source: "jsonld-test",
      jsonLd: [
        {
          "@type": "RealEstateListing",
          geo: {
            latitude: 41.108047,
            longitude: 16.689592,
          },
        },
      ],
    });

    expect(coordinates).toMatchObject({
      latitude: 41.108047,
      longitude: 16.689592,
    });
    expect(coordinates?.source).toContain("jsonld");
  });

  it("extracts coordinates from map URLs without using path bounds", () => {
    const coordinates = extractListingCoordinates({
      source: "html-test",
      html: `
        <img src="https://maps.googleapis.com/maps/api/staticmap?center=41.107745,16.689233&zoom=14&path=color:red|41.12,16.68|41.10,16.70">
      `,
    });

    expect(coordinates).toMatchObject({
      latitude: 41.107745,
      longitude: 16.689233,
    });
  });

  it("rejects out-of-area coordinates", () => {
    expect(
      normalizeListingCoordinates({
        latitude: 45.4642,
        longitude: 9.19,
        source: "milan",
      }),
    ).toBeNull();
  });
});

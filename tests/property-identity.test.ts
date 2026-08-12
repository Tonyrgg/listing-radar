import { describe, expect, it } from "vitest";

import {
  buildPropertyIdentityKey,
  comparePropertyIdentity,
  extractAddressIdentity,
} from "@/lib/listings/property-identity";

describe("physical property identity", () => {
  it("merges the same home found on Casa.it and Idealista", () => {
    const idealista = {
      title: "Trilocale in vendita in Corso Vittorio Emanuele II, 33",
      address_raw: "Città, Bitonto",
      description: "Luminoso trilocale con doppia esposizione e terrazzo a livello.",
      price: 159000,
      sqm: 114,
      rooms: 3,
    };
    const casa = {
      title: "Trilocale in Vendita in Corso Vittorio Emanuele II 33 a Bitonto",
      address_raw: "Vai alla mappa StreetView Corso Vittorio Emanuele II 33, Bitonto (BA)",
      description: "Luminoso trilocale con doppia esposizione e terrazzo a livello.",
      price: 159000,
      sqm: 114,
      rooms: 3,
    };

    const result = comparePropertyIdentity(idealista, casa);

    expect(result.autoMerge).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.82);
    expect(buildPropertyIdentityKey(idealista)).toBe(buildPropertyIdentityKey(casa));
  });

  it("keeps two different apartments at the same civic separated", () => {
    const result = comparePropertyIdentity(
      {
        title: "Trilocale in via Giovanna da Durazzo, 1",
        price: 217500,
        sqm: 60,
        rooms: 3,
        floor: "1",
      },
      {
        title: "Trilocale in via Giovanna da Durazzo, 1",
        price: 321000,
        sqm: 98,
        rooms: 3,
        floor: "4",
      },
    );

    expect(result.autoMerge).toBe(false);
    expect(result.score).toBe(0);
  });

  it("extracts a stable street and civic from a portal title", () => {
    expect(
      extractAddressIdentity({
        title: "Appartamento in vendita in Via Nicola Gliro, 13",
      }),
    ).toEqual({
      street: "via nicola gliro",
      civic: "13",
      key: "via:nicola gliro:13",
    });
  });
});

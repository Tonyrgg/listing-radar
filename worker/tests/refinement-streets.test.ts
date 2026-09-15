import { describe, expect, it } from "vitest";

import { mergeRefinementInventories, refinementStreetQueries } from "../src/services/runner.js";
import type { CrmPropertySummary } from "../src/import-v2/model.js";

const property = (id: string, displayName: string): CrmPropertySummary => ({
  id,
  displayName,
  fullAddress: null,
  cadastral: null,
});

describe("nomi alternativi della Rifinitura", () => {
  it("cerca il nome SISTER e il secondo nome Cloud senza duplicare la stessa dicitura", () => {
    expect(refinementStreetQueries(" via domenico damascelli ", "via dottor domenico damascelli")).toEqual([
      "via domenico damascelli",
      "via dottor domenico damascelli",
    ]);
    expect(refinementStreetQueries("Via Domenico Damascelli", "via domenico damascelli")).toEqual([
      "Via Domenico Damascelli",
    ]);
  });

  it("unisce gli immobili trovati con i due nomi usando l'ID Cloud", () => {
    expect(mergeRefinementInventories([
      [property("im-1", "Via Domenico Damascelli 1")],
      [property("im-1", "Via Dottor Domenico Damascelli 1"), property("im-2", "Via Dottor Domenico Damascelli 3")],
    ]).map(({ id }) => id)).toEqual(["im-1", "im-2"]);
  });
});

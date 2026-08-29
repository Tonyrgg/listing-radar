import { describe, expect, it } from "vitest";

import {
  formaPosizione,
  raggioPosizione,
  zoomPosizione,
} from "@/lib/map/posizione-casa";

const punto = { latitude: 41.107, longitude: 16.69 };

describe("dove si trova una casa", () => {
  it("mette lo spillo solo dove l'immobile lo conosciamo davvero", () => {
    expect(formaPosizione({ ...punto, precision: "EXACT_ADDRESS" })).toBe("spillo");
    // Qualcuno l'ha guardata e ha detto «è qui»: vale quanto un indirizzo esatto.
    expect(
      formaPosizione({ ...punto, precision: "STREET_ONLY", manuallyVerified: true }),
    ).toBe("spillo");
  });

  it("disegna l'area quando sappiamo la via ma non il civico", () => {
    expect(formaPosizione({ ...punto, precision: "STREET_ONLY" })).toBe("area");
    expect(formaPosizione({ ...punto, precision: "APPROXIMATE_AREA" })).toBe("area");
    // Più larga è l'ignoranza, più largo il cerchio e più lontano lo sguardo.
    expect(raggioPosizione("APPROXIMATE_AREA")).toBeGreaterThan(raggioPosizione("STREET_ONLY"));
    expect(zoomPosizione("area", "APPROXIMATE_AREA")).toBeLessThan(
      zoomPosizione("area", "STREET_ONLY"),
    );
  });

  it("non disegna niente quando non sappiamo dove sta", () => {
    expect(formaPosizione(null)).toBe("niente");
    expect(formaPosizione({ ...punto, precision: "UNKNOWN" })).toBe("niente");
    // Coordinate mancanti: nessuna precisione dichiarata le rimpiazza.
    expect(
      formaPosizione({ latitude: null, longitude: null, precision: "EXACT_ADDRESS" }),
    ).toBe("niente");
    expect(
      formaPosizione({ latitude: 41.1, longitude: null, precision: "EXACT_ADDRESS" }),
    ).toBe("niente");
  });

  it("guarda più da vicino lo spillo che l'area", () => {
    expect(zoomPosizione("spillo", "EXACT_ADDRESS")).toBeGreaterThan(
      zoomPosizione("area", "STREET_ONLY"),
    );
  });
});

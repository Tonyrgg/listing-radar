import { describe, expect, it } from "vitest";

import { decidePortalIntake, isPortalSource } from "@/lib/listings/portal-intake";

/**
 * La regola che decide cosa entra dai portali. Sbagliarla in un senso riempie
 * l'archivio di doppioni; sbagliarla nell'altro butta via i privati, che sono
 * l'unica cosa che i portali possono aggiungere.
 */
describe("cosa accettiamo dai portali", () => {
  it("scarta le agenzie: le seguiamo già dai loro siti", () => {
    const decision = decidePortalIntake({
      source: "casa",
      sellerType: "agency",
      sellerName: "Studi Santi Immobiliare",
    });

    expect(decision.accepted).toBe(false);
    expect(decision.accepted === false && decision.reason).toContain("Studi Santi");
  });

  it("tiene i privati", () => {
    expect(decidePortalIntake({ source: "idealista", sellerType: "private" }).accepted).toBe(true);
  });

  it("tiene anche gli incerti: un privato quasi mai si dichiara tale", () => {
    expect(decidePortalIntake({ source: "immobiliare", sellerType: "unknown" }).accepted).toBe(true);
    expect(decidePortalIntake({ source: "casa", sellerType: null }).accepted).toBe(true);
  });

  it("non tocca le fonti che non sono portali", () => {
    /* Le due agenzie ancora lette da V1 non passano da questa regola. */
    expect(
      decidePortalIntake({ source: "ingegnericolapinto", sellerType: "agency" }).accepted,
    ).toBe(true);
  });

  it("riconosce i portali, comunque siano scritti", () => {
    expect(isPortalSource("Immobiliare")).toBe(true);
    expect(isPortalSource(" idealista ")).toBe(true);
    expect(isPortalSource("subito")).toBe(true);
    expect(isPortalSource("vistocasa")).toBe(false);
  });
});

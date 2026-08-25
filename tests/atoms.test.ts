import { describe, expect, it } from "vitest";

import { signalsFromOpportunity } from "@/components/property-row";

import {
  certaintyFromConfidence,
  livelloFromOpportunity,
} from "@/components/ui/atoms";

/**
 * Gli atomi sono il contratto fra le pagine vecchie e quelle riscritte.
 * Qui si blocca la parte che decide: come la confidenza del modello diventa
 * uno dei tre stati che l'occhio distingue.
 */
describe("atomi · la certezza di un dato", () => {
  it("chiama certo solo ciò che la fonte dichiara con forza", () => {
    expect(certaintyFromConfidence(1)).toBe("sure");
    expect(certaintyFromConfidence(0.85)).toBe("sure");
  });

  it("chiama dedotto tutto ciò che sta sotto la soglia", () => {
    expect(certaintyFromConfidence(0.84)).toBe("guess");
    expect(certaintyFromConfidence(0.2)).toBe("guess");
    expect(certaintyFromConfidence(0)).toBe("guess");
  });

  it("chiama ignoto ciò per cui non esiste una confidenza", () => {
    expect(certaintyFromConfidence(null)).toBe("unknown");
    expect(certaintyFromConfidence(undefined)).toBe("unknown");
  });

  it("tratta come certo ciò che hai confermato a mano, qualunque sia la confidenza", () => {
    expect(certaintyFromConfidence(null, { manuallyVerified: true })).toBe("sure");
    expect(certaintyFromConfidence(0.1, { manuallyVerified: true })).toBe("sure");
  });
});

describe("atomi · il giudizio", () => {
  it("traduce i livelli del lifecycle in parole", () => {
    expect(livelloFromOpportunity("HOT")).toBe("alta");
    expect(livelloFromOpportunity("HIGH")).toBe("alta");
    expect(livelloFromOpportunity("INTERESTING")).toBe("media");
    expect(livelloFromOpportunity("WATCH")).toBe("bassa");
  });

  it("non lascia mai passare una costante non riconosciuta", () => {
    expect(livelloFromOpportunity(null)).toBe("bassa");
    expect(livelloFromOpportunity("QUALCOSA_DI_NUOVO")).toBe("bassa");
  });
});

describe("gli indizi di un'opportunità", () => {
  it("non conta come indizio l'assenza di un segnale", () => {
    const segnali = signalsFromOpportunity({
      level: "WATCH",
      reasons: ["no_current_opportunity_signal"],
    });

    expect(segnali.indizi).toBe(0);
    expect(segnali.motivo).toBeNull();
  });

  it("conta gli indizi veri e ne scrive il primo", () => {
    const segnali = signalsFromOpportunity({
      level: "INTERESTING",
      reasons: ["agency_exit_under_review", "no_sale_evidence"],
    });

    expect(segnali.indizi).toBe(2);
    expect(segnali.motivo).toBe("Uscita in verifica");
    expect(segnali.livello).toBe("media");
  });

  it("regge un'opportunità senza ragioni", () => {
    expect(signalsFromOpportunity({ level: "WATCH", reasons: [] }).indizi).toBe(0);
  });
});

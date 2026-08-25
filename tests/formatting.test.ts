import { describe, expect, it } from "vitest";

import { formatCurrency, formatNumber } from "@/lib/formatting";

/**
 * `Intl.NumberFormat` di suo raggruppa solo da cinque cifre in su: senza dirlo
 * esplicitamente un prezzo di 7000 euro esce «7000 €», che a colpo d'occhio si
 * legge 700 o 70.000. In un tool che si guarda, non si legge, è un errore.
 */
describe("come si scrivono i numeri", () => {
  it("separa le migliaia anche a quattro cifre", () => {
    expect(formatCurrency(7000)).toContain("7.000");
    expect(formatNumber(1000)).toBe("1.000");
  });

  it("continua a separarle sopra le quattro cifre", () => {
    expect(formatCurrency(120000)).toContain("120.000");
  });

  it("dice a parole quando il numero non c'è", () => {
    expect(formatCurrency(null)).toBe("Non disponibile");
    expect(formatNumber(undefined)).toBe("Non disponibile");
  });
});

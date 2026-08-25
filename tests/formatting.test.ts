import { describe, expect, it } from "vitest";

import { formatCurrency, formatNumber, formatShouty, isUsableText } from "@/lib/formatting";

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

describe("i testi che gridano o sussurrano", () => {
  it("riporta il maiuscolo iniziale su un indirizzo urlato", () => {
    expect(formatShouty("VIA PIEPOLI")).toBe("Via Piepoli");
  });

  it("fa lo stesso con un indirizzo tutto minuscolo", () => {
    expect(formatShouty("via anita garibaldi, 4")).toBe("Via Anita Garibaldi, 4");
  });

  it("non tocca un testo già scritto normalmente", () => {
    expect(formatShouty("Largo Teatro Umberto")).toBe("Largo Teatro Umberto");
  });
});

describe("i testi che il portale non ha davvero dato", () => {
  it("scarta una zona che è un pezzo di pagina", () => {
    const blob =
      "Vai alla mappa StreetView Via Generale Pasquale Mirabella, Bitonto (BA) Vicino a: Fermate dei mezzi pubblici a 140m";
    expect(isUsableText(blob, { maxLength: 60 })).toBe(false);
  });

  it("scarta una descrizione che è il selettore della lingua", () => {
    expect(isUsableText("Italiano", { minLength: 25 })).toBe(false);
  });

  it("tiene una zona vera", () => {
    expect(isUsableText("Zona Santi Medici", { maxLength: 60 })).toBe(true);
  });
});

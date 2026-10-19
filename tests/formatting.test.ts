import { describe, expect, it } from "vitest";

import { formatCurrency, formatDate, formatDateTime, formatNumber, formatShouty, formatTime, isUsableText } from "@/lib/formatting";

/**
 * `Intl.NumberFormat` di suo raggruppa solo da cinque cifre in su: senza dirlo
 * esplicitamente un prezzo di 7000 euro esce «7000 €», che a colpo d'occhio si
 * legge 700 o 70.000. In un tool che si guarda, non si legge, è un errore.
 */
describe("come si scrivono i numeri", () => {
  it("keeps the evidence observation day identical across UTC server and Rome browser", () => {
    expect(formatDate("2026-10-14T23:15:00Z")).toBe("15 ott 2026");
    expect(formatDate("2026-01-31T23:30:00Z")).toBe("1 feb 2026");
    expect(formatTime("2026-10-14T23:15:00Z")).toBe("01:15");
    expect(formatTime("2026-01-31T23:30:00Z")).toBe("00:30");
  });

  it("preserves a date-only portal claim without inventing an observation time", () => {
    expect(formatDate("2026-05-05")).toBe("5 mag 2026");
    expect(formatDate(null)).toBe("Non disponibile");
    expect(formatDate("not a date")).toBe("Non disponibile");
    expect(formatTime(null)).toBe("");
  });
  it("shows observation timestamps in the market timezone independently of the server timezone",()=>{
    expect(formatDateTime("2026-10-19T18:29:00Z")).toContain("20:29");
    expect(formatDateTime("2026-01-19T18:29:00Z")).toContain("19:29");
    expect(formatDateTime(null)).toBe("Non disponibile");
  });
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

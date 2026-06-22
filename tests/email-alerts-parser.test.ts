import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { parseAlertEmail } from "@/lib/email-alerts/parser";
import { parsePrice } from "@/lib/scrapers/parsers";

describe("email alert parsing", () => {
  it("extracts Casa.it prices before the amount without polluting the zone", () => {
    const html = `
      <table>
        <tr>
          <td>
            <a href="https://www.casa.it/immobili/123456/">
              Appartamento in vendita in Piazzetta Caffarelli,
            </a>
            <p>Bitonto (BA) \u20ac93.000 65 m\u00b2 3 locali 1 bagno</p>
            <p>Prezzo su richiesta per annunci simili</p>
          </td>
        </tr>
      </table>
    `;

    const rows = parseAlertEmail({
      sender: "Casa.it <alert@casa.it>",
      subject: "Riepilogo e suggerimenti per la tua ricerca Bitonto (BA)",
      html,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "casa",
      sourceListingId: "123456",
      price: 93000,
      sqm: 65,
      rooms: 3,
      zone: "Bitonto (BA)",
    });
  });

  it("prefers a concrete price over an incidental price-on-request label", () => {
    expect(parsePrice("Prezzo su richiesta Bitonto \u20ac93.000 65 m\u00b2")).toBe(
      93000,
    );
    expect(parsePrice("Prezzo su richiesta")).toBeNull();
  });

  it("parses Casa.it sale prices with spaced thousands separators", () => {
    const html = `
      <table>
        <tr>
          <td>
            <a href="https://www.casa.it/immobili/52882077/">
              Appartamento in vendita in Via Dante Alighieri 60,
            </a>
            <p>Bitonto (BA) \u20ac 150 .000 110 m\u00b2 4 locali 1 bagno</p>
            <p>Vedi 4 foto e dettagli</p>
          </td>
        </tr>
      </table>
    `;

    const rows = parseAlertEmail({
      sender: "Casa.it <alert@casa.it>",
      subject: "Riepilogo e suggerimenti per la tua ricerca Bitonto (BA)",
      html,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "casa",
      sourceListingId: "52882077",
      price: 150000,
      sqm: 110,
      rooms: 4,
      zone: "Bitonto (BA)",
    });
  });

  it("does not treat truncated three-digit currency as a sale price", () => {
    expect(
      parsePrice("Appartamento in vendita Bitonto \u20ac 150 110 m\u00b2 4 locali"),
    ).toBeNull();
    expect(parsePrice("150 euro 110 mq 4 locali")).toBeNull();
    expect(parsePrice("\u20ac 150.000 110 m\u00b2")).toBe(150000);
  });

  it("ignores Idealista alerts outside Bitonto even when the search subject mentions Bitonto", () => {
    const html = `
      <article>
        <a href="https://www.idealista.it/immobile/99887766/">
          Quadrilocale in vendita a Terlizzi
        </a>
        <p>Terlizzi (BA) 120.000 euro 90 m\u00b2 3 locali</p>
      </article>
    `;

    const rows = parseAlertEmail({
      sender: "idealista <alert@idealista.it>",
      subject: "Nuovi immobili per la tua ricerca Bitonto",
      html,
    });

    expect(rows).toHaveLength(0);
  });
});

describe("extension generic parser", () => {
  it("extracts prices when the euro symbol appears before the amount", () => {
    const context = vm.createContext({});
    const source = readFileSync(
      new URL("../extension/parsers/generic.js", import.meta.url),
      "utf8",
    );

    vm.runInContext(source, context);

    const parser = (
      context as typeof context & {
        ListingRadarGenericParser: {
          parsePrice(value: string): number | null;
        };
      }
    ).ListingRadarGenericParser;

    expect(parser.parsePrice("\u20ac 93.000")).toBe(93000);
    expect(parser.parsePrice("93.000 euro")).toBe(93000);
    expect(parser.parsePrice("\u20ac 150 .000 110 m\u00b2")).toBe(150000);
    expect(parser.parsePrice("\u20ac 150 110 m\u00b2")).toBeNull();
  });
});

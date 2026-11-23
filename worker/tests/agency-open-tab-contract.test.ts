import { describe, expect, it } from "vitest";
import { openTabIdentity, openTabSignature, openTabSource } from "../src/agency-browser/open-tab-contract.js";

describe("Identità di un annuncio da una scheda aperta", () => {
  it("riconosce la scheda d’agenzia e la scheda sul portale con la loro identità", () => {
    expect(openTabSource("https://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000809/3915/")?.source.id).toBe("studisanti");
    expect(openTabSource("https://www.casa.it/immobili/123456/?tracking=tag")?.source.id).toBe("casa");
    expect(openTabSource("https://www.vistocasa.com/it/immobile.aspx?articoliid=9161&tracking=tag")?.url)
      .toBe("https://www.vistocasa.com/it/immobile.aspx?ArticoliId=9161");
  });

  it("riconosce la scheda di Studi Santi segnalata dall’ufficio e il suo alias", () => {
    const opened = openTabSource("https://www.studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000779/3881/");
    const canonical = openTabSource("https://studisantiimmobiliare.it/it/vendite/bitonto/appartamento/v000779/3881/");
    const other = openTabSource("https://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000778/3880/");
    expect(opened).not.toBeNull();
    expect(openTabIdentity(opened!)).toBe(openTabIdentity(canonical!));
    expect(openTabIdentity(opened!)).not.toBe(openTabIdentity(other!));
  });

  it("ignora cataloghi, domini estranei e destinazioni che solo imitano una fonte", () => {
    expect(openTabSource("https://www.immobiliare.it/vendita-case/bitonto/")).toBeNull();
    expect(openTabSource("https://www.immobiliare.it.example.test/annunci/1234/")).toBeNull();
    expect(openTabSource("http://www.immobiliare.it/annunci/1234/")).toBeNull();
  });

  it("vincola la firma al corpo e all’istante di invio", () => {
    const signature = openTabSignature("fixture", "1795445000000", "{}");
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(openTabSignature("fixture", "1795445000001", "{}")).not.toBe(signature);
    expect(openTabSignature("fixture", "1795445000000", "[]")).not.toBe(signature);
  });
});

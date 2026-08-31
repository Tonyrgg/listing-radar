import { describe, expect, it } from "vitest";

import { matchesWorkerPortal } from "../src/core/browser-page-matching.js";

describe("riconoscimento delle schede del worker", () => {
  it("riconosce SISTER dal dominio anche se il match salvato e' obsoleto", () => {
    expect(matchesWorkerPortal({
      title: "Ricerca persona fisica",
      url: "https://sister3.agenziaentrate.gov.it/Visure/DataRichiesta.do",
    }, "vecchio titolo sister", "sister")).toBe(true);
  });

  it("riconosce il gestionale dal dominio anche se il match salvato e' obsoleto", () => {
    expect(matchesWorkerPortal({
      title: "Home",
      url: "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/",
    }, "vecchio gestionale", "crm")).toBe(true);
  });

  it("continua a supportare un match configurato personalizzato", () => {
    expect(matchesWorkerPortal({ title: "Portale interno", url: "https://example.test" }, "portale interno", "crm"))
      .toBe(true);
  });

  it("non confonde una scheda generica con i portali", () => {
    const page = { title: "Home", url: "https://example.test" };
    expect(matchesWorkerPortal(page, "non presente", "sister")).toBe(false);
    expect(matchesWorkerPortal(page, "non presente", "crm")).toBe(false);
  });
});

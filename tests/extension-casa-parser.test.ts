import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

class FakeElement {
  readonly currentSrc = "";

  constructor(
    readonly selectors: string[],
    readonly textContent: string,
    readonly attributes: Record<string, string> = {},
  ) {}

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}

class FakeDocument {
  readonly body: { innerText: string };

  constructor(
    bodyText: string,
    private readonly elements: FakeElement[],
  ) {
    this.body = { innerText: bodyText };
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string) {
    const parts = selector.split(",").map((part) => part.trim());

    return this.elements.filter((element) =>
      parts.some((part) => this.matches(element, part)),
    );
  }

  private matches(element: FakeElement, selector: string) {
    if (element.selectors.includes(selector)) {
      return true;
    }

    if (selector === "button") {
      return element.selectors.includes("button");
    }

    if (selector === "a") {
      return element.selectors.includes("a");
    }

    if (selector === "script") {
      return element.selectors.includes("script");
    }

    if (selector === "a[href^='tel:']") {
      return element.selectors.includes("a") && /^tel:/i.test(element.attributes.href ?? "");
    }

    if (selector === "[role='button']") {
      return element.attributes.role === "button";
    }

    const dataTestIdContains = selector.match(/\[data-testid\*='([^']+)' i\]/);
    if (dataTestIdContains) {
      return (element.attributes["data-testid"] ?? "")
        .toLowerCase()
        .includes(dataTestIdContains[1].toLowerCase());
    }

    const classContains = selector.match(/\[class\*='([^']+)' i\]/);
    if (classContains) {
      return (element.attributes.class ?? "")
        .toLowerCase()
        .includes(classContains[1].toLowerCase());
    }

    const attrContains = selector.match(/\[(aria-label|title)\*='([^']+)' i\]/);
    if (attrContains) {
      return (element.attributes[attrContains[1]] ?? "")
        .toLowerCase()
        .includes(attrContains[2].toLowerCase());
    }

    const attrPresent = selector.match(/^\[(data-[^\]]+)\]$/);
    if (attrPresent) {
      return element.attributes[attrPresent[1]] != null;
    }

    return false;
  }
}

function runCasaParser(document: FakeDocument) {
  const context = vm.createContext({
    document,
    location: {
      href: "https://www.casa.it/immobili/52585300/",
      hostname: "www.casa.it",
    },
    URL,
  });
  const files = [
    "../extension/parsers/generic.js",
    "../extension/parsers/shared.js",
    "../extension/parsers/casa.js",
  ];

  files.forEach((file) => {
    vm.runInContext(
      readFileSync(new URL(file, import.meta.url), "utf8"),
      context,
    );
  });

  return (
    context as typeof context & {
      ListingRadarPortalAdapters: {
        casa: {
          extract(): {
            sellerName: string | null;
            sellerType: string;
            phone: string | null;
          };
        };
      };
    }
  ).ListingRadarPortalAdapters.casa.extract();
}

describe("Casa.it extension parser", () => {
  it("extracts agency seller details and phone from the contact card", () => {
    const bodyText = [
      "Trilocale in Vendita in Via Giorgio La Pira a Bitonto",
      "Gestita da",
      "Futura Immobiliare",
      "Chiama ora 080 1234567",
      "Data ultimo aggiornamento 6 Giugno 2026",
    ].join("\n");
    const listing = runCasaParser(
      new FakeDocument(bodyText, [
        new FakeElement(
          ["[data-testid='listing-title']"],
          "Trilocale in Vendita in Via Giorgio La Pira a Bitonto",
        ),
        new FakeElement(
          ["[data-testid='description']"],
          "In zona servitissima, proponiamo in vendita un appartamento.",
        ),
        new FakeElement(["[data-testid='features']"], "82 m\u00b2 3 locali 1 bagno"),
        new FakeElement(["[data-testid='price']"], "\u20ac 158.000"),
        new FakeElement(
          ["[data-testid='agency-card']"],
          "Gestita da Futura Immobiliare Chiama ora 080 1234567",
          {
            "data-testid": "agency-card",
          },
        ),
        new FakeElement(["button"], "Chiama ora 080 1234567", {
          "aria-label": "Chiama ora 080 1234567",
        }),
      ]),
    );

    expect(listing.sellerName).toBe("Futura Immobiliare");
    expect(listing.sellerType).toBe("agency");
    expect(listing.phone).toBe("0801234567");
  });

  it("extracts agency names that do not contain real-estate keywords", () => {
    const bodyText = [
      "Bilocale in vendita a Bitonto",
      "Professionista",
      "Studio Tre",
      "Chiama ora 080 7654321",
    ].join("\n");
    const listing = runCasaParser(
      new FakeDocument(bodyText, [
        new FakeElement(["[data-testid='listing-title']"], "Bilocale in vendita a Bitonto"),
        new FakeElement(["[data-testid='description']"], "Soluzione in buone condizioni."),
        new FakeElement(["[data-testid='features']"], "70 m\u00b2 2 locali"),
        new FakeElement(["[data-testid='price']"], "\u20ac 110.000"),
        new FakeElement(["[data-testid='contact-card']"], "Professionista Studio Tre Chiama ora", {
          "data-testid": "contact-card",
        }),
        new FakeElement(["button"], "Chiama ora 080 7654321", {
          "aria-label": "Chiama ora 080 7654321",
        }),
      ]),
    );

    expect(listing.sellerName).toBe("Studio Tre");
    expect(listing.sellerType).toBe("agency");
    expect(listing.phone).toBe("0807654321");
  });

  it("reads seller details from Casa.it structured page data", () => {
    const listing = runCasaParser(
      new FakeDocument("Trilocale in vendita a Bitonto", [
        new FakeElement(["[data-testid='listing-title']"], "Trilocale in vendita a Bitonto"),
        new FakeElement(["[data-testid='description']"], "Appartamento con balcone."),
        new FakeElement(["[data-testid='features']"], "95 m\u00b2 3 locali"),
        new FakeElement(["[data-testid='price']"], "\u20ac 175.000"),
        new FakeElement(
          ["script"],
          JSON.stringify({
            props: {
              pageProps: {
                listing: {
                  advertiser: {
                    name: "Studio Bitonto",
                    type: "agency",
                  },
                },
              },
            },
          }),
        ),
      ]),
    );

    expect(listing.sellerName).toBe("Studio Bitonto");
    expect(listing.sellerType).toBe("agency");
  });

  it("extracts private seller names when the advertiser section declares a private owner", () => {
    const bodyText = [
      "Casa indipendente in vendita a Bitonto",
      "Inserzionista",
      "Privato",
      "Mario Rossi",
      "Chiama ora 333 1234567",
    ].join("\n");
    const listing = runCasaParser(
      new FakeDocument(bodyText, [
        new FakeElement(
          ["[data-testid='listing-title']"],
          "Casa indipendente in vendita a Bitonto",
        ),
        new FakeElement(["[data-testid='description']"], "Vendita diretta da privato."),
        new FakeElement(["[data-testid='features']"], "120 m\u00b2 4 locali"),
        new FakeElement(["[data-testid='price']"], "\u20ac 210.000"),
        new FakeElement(
          ["[data-testid='advertiser-card']"],
          "Inserzionista Privato Mario Rossi Chiama ora",
          {
            "data-testid": "advertiser-card",
          },
        ),
        new FakeElement(["button"], "Chiama ora 333 1234567", {
          "aria-label": "Chiama ora 333 1234567",
        }),
      ]),
    );

    expect(listing.sellerName).toBe("Mario Rossi");
    expect(listing.sellerType).toBe("private");
    expect(listing.phone).toBe("3331234567");
  });
});

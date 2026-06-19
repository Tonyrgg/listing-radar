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
});

import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

class FakeElement {
  readonly currentSrc: string;
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;

  constructor(
    readonly tagName: string,
    readonly selectors: string[],
    readonly textContent: string,
    readonly attributes: Record<string, string> = {},
  ) {
    this.currentSrc = attributes.currentSrc ?? "";
    this.width = Number(attributes.width) || 0;
    this.height = Number(attributes.height) || 0;
    this.naturalWidth = Number(attributes.naturalWidth) || this.width;
    this.naturalHeight = Number(attributes.naturalHeight) || this.height;
  }

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

    if (selector === "img") {
      return element.tagName === "img";
    }

    if (selector === "script") {
      return element.tagName === "script";
    }

    const tagWithAttribute = selector.match(/^(\w+)(?:\s+\w+)?\[([^=\]]+)(?:=[^\]]+)?\]$/);

    if (tagWithAttribute) {
      return (
        element.tagName === tagWithAttribute[1] &&
        element.getAttribute(tagWithAttribute[2]) != null
      );
    }

    return false;
  }
}

function runIdealistaParser(document: FakeDocument) {
  const context = vm.createContext({
    document,
    location: {
      href: "https://www.idealista.it/immobile/123456/",
      hostname: "www.idealista.it",
      hash: "",
    },
    URL,
    URLSearchParams,
  });
  const files = [
    "../extension/parsers/generic.js",
    "../extension/parsers/shared.js",
    "../extension/parsers/idealista.js",
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
        idealista: {
          extract(): {
            imageUrl: string | null;
            imageUrls: string[];
          };
        };
      };
    }
  ).ListingRadarPortalAdapters.idealista.extract();
}

describe("Idealista extension parser", () => {
  it("keeps property photos and rejects language flags", () => {
    const listing = runIdealistaParser(
      new FakeDocument(
        [
          "Appartamento in vendita a Bitonto",
          "120.000 euro",
          "90 m2 3 locali",
          "Persona che pubblica l'annuncio",
          "Professionista Futura Immobiliare",
        ].join("\n"),
        [
          new FakeElement(
            "h1",
            [".main-info__title-main"],
            "Appartamento in vendita a Bitonto",
          ),
          new FakeElement("div", [".comment"], "Appartamento luminoso in centro."),
          new FakeElement("div", [".info-features"], "90 m2 3 locali"),
          new FakeElement("div", [".info-data-price"], "120.000 euro"),
          new FakeElement(
            "img",
            ["img[src]"],
            "",
            {
              src: "https://st3.idealista.it/static/common/img/flags/it.png",
              alt: "Italiano",
              width: "24",
              height: "16",
            },
          ),
          new FakeElement(
            "img",
            ["img[src]"],
            "",
            {
              src: "https://img4.idealista.it/blur/WEB_DETAIL-L-L/0/id.pro.it.image.master/12/34/56/property.webp",
              alt: "Foto appartamento",
              width: "800",
              height: "600",
            },
          ),
          new FakeElement(
            "script",
            ["script"],
            'window.__flags=["https:\\/\\/st3.idealista.it\\/static\\/flags\\/en.png"];',
          ),
        ],
      ),
    );

    expect(listing.imageUrl).toBe(
      "https://img4.idealista.it/blur/WEB_DETAIL-L-L/0/id.pro.it.image.master/12/34/56/property.webp",
    );
    expect(listing.imageUrls).toEqual([listing.imageUrl]);
  });
});

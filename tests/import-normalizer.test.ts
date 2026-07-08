import { describe, expect, it } from "vitest";

import { normalizeImportedRows } from "@/lib/scrapers/import-normalizer";

function row(input: Record<string, unknown>) {
  return {
    title: "Trilocale in centro",
    url: "https://www.subito.it/appartamenti/trilocale-bitonto-123456.htm",
    ...input,
  };
}

describe("normalizeImportedRows", () => {
  it("canonicalizes portal source names", () => {
    const normalized = normalizeImportedRows(
      [
        row({
          source: "Subito",
        }),
      ],
      { provider: "import", defaultSource: "import" },
    );

    expect(normalized.listings[0]?.source).toBe("subito");
  });

  it("infers portal source from URL when the import source is generic", () => {
    const normalized = normalizeImportedRows(
      [
        row({
          source: "browser",
          url: "https://www.casadaprivato.it/appartamento-vendita-bitonto-98765",
        }),
        row({
          source: "feed",
          url: "https://www.bakeca.it/annunci/vendita-case/bitonto-casa-45678",
        }),
      ],
      { provider: "feed", defaultSource: "feed" },
    );

    expect(normalized.listings.map((listing) => listing.source)).toEqual([
      "casadaprivato",
      "bakeca",
    ]);
  });

  it("keeps valid listing coordinates", () => {
    const normalized = normalizeImportedRows(
      [
        row({
          latitude: "41.107745",
          longitude: "16.689233",
          coordinatesSource: "browser:jsonld",
        }),
      ],
      { provider: "browser-extension", defaultSource: "browser" },
    );

    expect(normalized.listings[0]).toMatchObject({
      latitude: 41.107745,
      longitude: 16.689233,
      coordinatesSource: "browser:jsonld",
    });
  });
});

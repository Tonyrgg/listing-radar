import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HttpResponse } from "@/lib/http/client";
import {
  normalizeIconacasaDetail,
  parseIconacasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/iconacasa";
import {
  normalizePuntoCasaDetail,
  parsePuntoCasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/puntocasa";
import type { InventoryItem, SourceDocument } from "@/lib/property-lifecycle/adapters/types";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "property-lifecycle");

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function sourceDocument(
  file: string,
  url: string,
  externalId: string,
  observedAt = "2026-08-19T09:00:00.000Z",
): SourceDocument {
  const item: InventoryItem = { sourceKey: externalId, externalId, url, summary: {} };
  const response: HttpResponse = {
    body: fixture(file),
    headers: new Headers({ "last-modified": "Wed, 19 Aug 2026 09:00:00 GMT" }),
    ok: true,
    status: 200,
    url,
  };
  return { item, response, observedAt };
}

describe("Iconacasa V2 adapter", () => {
  it("extracts a complete 20-sale golden inventory and excludes rentals", () => {
    const result = parseIconacasaInventoryHtml(fixture("iconacasa-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items.every((item) => !/affitto|locazione/.test(item.url))).toBe(true);
  });

  it("normalizes source identity, commercial facts, geography, status, and scoped media", () => {
    const url =
      "https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento";
    const result = normalizeIconacasaDetail(
      sourceDocument("iconacasa-active-detail.html", url, "45212"),
    );

    expect(result.source.externalId).toBe("45212");
    expect(result.source.agencyReference).toBe("BTN150");
    expect(result.commercial.priceAmount).toBe(137_000);
    expect(result.commercial.surfaceSqm).toBe(144);
    expect(result.location).toMatchObject({ scope: "IN_SCOPE", locality: "Palombaio" });
    expect(result.status.value).toBe("ACTIVE");
    expect(result.assets).toHaveLength(2);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(result.marketStart.method).toBe("CRAWLER_FIRST_SEEN");
  });

  it("recognizes a dedicated sold label", () => {
    const url =
      "https://www.iconacasa.com/index.php/opportunita/property/45213-bitonto-vendita-villa";
    const result = normalizeIconacasaDetail(
      sourceDocument("iconacasa-sold-detail.html", url, "45213"),
    );
    expect(result.status.value).toBe("SOLD");
    expect(result.status.evidence[0]?.extractionMethod).toBe("ICONACASA_DEDICATED_LABEL");
  });

  it("reports a structure change when required inventory markers disappear", () => {
    const result = parseIconacasaInventoryHtml("<html><body>maintenance</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });

  it("does not call a first page healthy when pagination remains", () => {
    const paginated = fixture("iconacasa-inventory.html").replace(
      "</body>",
      '<a href="/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro?start=20">2</a></body>',
    );
    const result = parseIconacasaInventoryHtml(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 2 });
  });
});

describe("PuntoCasa V2 adapter", () => {
  it("extracts a complete 20-record golden inventory", () => {
    const result = parsePuntoCasaInventoryHtml(fixture("puntocasa-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
  });

  it("does not call a first page healthy when pagination remains", () => {
    const paginated = fixture("puntocasa-inventory.html").replace(
      "</body>",
      '<a href="https://www.puntocasagroup.it/acquista-la-tua-casa-2/page/22/">22</a></body>',
    );
    const result = parsePuntoCasaInventoryHtml(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 22 });
  });

  it("uses dedicated status and ignores sold text in related cards", () => {
    const url = "https://www.puntocasagroup.it/property-item/bitonto-zona-via-mazzini/";
    const result = normalizePuntoCasaDetail(
      sourceDocument("puntocasa-active-detail.html", url, "bitonto-zona-via-mazzini"),
    );

    expect(result.source.agencyReference).toBe("TR23");
    expect(result.status.value).toBe("ACTIVE");
    expect(result.commercial).toMatchObject({
      priceAmount: 450_000,
      surfaceSqm: 219,
      rooms: 6,
      bedrooms: 3,
      bathrooms: 2,
    });
    expect(result.location.scope).toBe("IN_SCOPE");
    expect(result.marketStart).toMatchObject({
      method: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
      lowerBound: "2024-03-01T00:00:00.000Z",
      upperBound: "2024-03-31T23:59:59.999Z",
    });
    expect(result.response.lastModified).toBeTruthy();
    expect(result.provenance.ignoredHttpLastModifiedForMarketStart).toBe(true);
  });

  it.each([
    ["puntocasa-sold-detail.html", "bitonto-zona-via-ricapito-2", "SOLD"],
    ["puntocasa-negotiation-detail.html", "bitonto-via-ammiraglio-vacca-3", "NEGOTIATION"],
  ] as const)("normalizes dedicated status in %s", (file, slug, expectedStatus) => {
    const url = `https://www.puntocasagroup.it/property-item/${slug}/`;
    const result = normalizePuntoCasaDetail(sourceDocument(file, url, slug));
    expect(result.status.value).toBe(expectedStatus);
  });
});

describe("normalized content hashing", () => {
  it("does not change only because crawler observation time changed", () => {
    const url =
      "https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento";
    const first = normalizeIconacasaDetail(
      sourceDocument("iconacasa-active-detail.html", url, "45212", "2026-08-19T09:00:00.000Z"),
    );
    const second = normalizeIconacasaDetail(
      sourceDocument("iconacasa-active-detail.html", url, "45212", "2026-08-20T09:00:00.000Z"),
    );
    expect(first.contentHash).toBe(second.contentHash);
  });
});

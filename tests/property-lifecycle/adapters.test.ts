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
import {
  normalizeStudiSantiDetail,
  parseStudiSantiSitemap,
} from "@/lib/property-lifecycle/adapters/studisanti";
import {
  normalizeVistocasaDetail,
  parseVistocasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/vistocasa";
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
  summary: Record<string, unknown> = {},
): SourceDocument {
  const item: InventoryItem = { sourceKey: externalId, externalId, url, summary };
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

describe("Vistocasa V2 adapter", () => {
  it("uses the complete embedded map inventory and excludes rentals", () => {
    const result = parseVistocasaInventoryHtml(fixture("vistocasa-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 1 });
    expect(result.items.some((item) => item.externalId === "rent-1")).toBe(false);
    expect(result.items.find((item) => item.externalId === "9931")?.summary).toMatchObject({
      soldGraphic: true,
      priceAmount: 290_000,
      latitude: 41.112382,
      longitude: 16.68452,
    });
  });

  it("normalizes facts and keeps active status unknown without dedicated evidence", () => {
    const url = "https://www.vistocasa.com/it/immobile.aspx?articoliid=10002";
    const result = normalizeVistocasaDetail(
      sourceDocument("vistocasa-active-detail.html", url, "10002", undefined, {
        latitude: 41.106875,
        longitude: 16.697617,
        imageUrl: "https://www.vistocasa.com/immobili/fotoimmobile10002/1.jpg",
      }),
    );

    expect(result.source).toMatchObject({ externalId: "10002", agencyReference: "BIT.T292" });
    expect(result.commercial).toMatchObject({
      priceAmount: 190_000,
      surfaceSqm: 95,
      rooms: 3,
      bathrooms: 1,
      floor: "4",
    });
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      scope: "IN_SCOPE",
      precision: "APPROXIMATE_AREA",
    });
    expect(result.status.value).toBe("UNKNOWN");
    expect(result.extractionWarnings).toContain("missing_dedicated_source_status");
    expect(result.assets).toHaveLength(2);
  });

  it("uses the listing-scoped sold graphic as status evidence but not a representative", () => {
    const url = "https://www.vistocasa.com/it/immobile.aspx?articoliid=9931";
    const result = normalizeVistocasaDetail(
      sourceDocument("vistocasa-sold-detail.html", url, "9931", undefined, {
        imageUrl: "https://www.vistocasa.com/immobili/fotoimmobile9931/Venduto.jpg",
        soldGraphic: true,
      }),
    );

    expect(result.status.value).toBe("SOLD");
    expect(result.status.evidence[0]?.extractionMethod).toBe(
      "VISTOCASA_DEDICATED_SOLD_GRAPHIC",
    );
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(
      result.assets.find((asset) => /venduto/i.test(asset.canonicalUrl))?.metadata,
    ).toMatchObject({ excludedFromRepresentative: true });
  });

  it("freezes absence decisions if the embedded map structure disappears", () => {
    const result = parseVistocasaInventoryHtml(
      "<html><body>Agenzia Vistocasa Bitonto in manutenzione</body></html>",
    );
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Studi Santi V2 adapter", () => {
  it("uses all sale entries in the public sitemap as a complete inventory", () => {
    const result = parseStudiSantiSitemap(fixture("studisanti-sitemap.xml"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items.find((item) => item.externalId === "3902")).toMatchObject({
      sourceKey: "3902",
      summary: { agencyReference: "V000797", sitemapLastModified: "2026-03-10" },
    });
    expect(result.items.every((item) => item.url.startsWith("https://"))).toBe(true);
  });

  it("normalizes Miogest identity, exact civic, facts, scoped media, and photo-batch age", () => {
    const url =
      "https://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000797/3902/";
    const result = normalizeStudiSantiDetail(
      sourceDocument("studisanti-active-detail.html", url, "3902"),
    );

    expect(result.source).toMatchObject({ externalId: "3902", agencyReference: "V000797" });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 163_000,
      surfaceSqm: 110,
      rooms: 4,
      bedrooms: 3,
      bathrooms: 1,
      floor: "1",
    });
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Via Durazzo",
      streetNumber: "35/1",
      precision: "EXACT_ADDRESS",
      scope: "IN_SCOPE",
    });
    expect(result.marketStart).toMatchObject({
      method: "MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS",
      lowerBound: "2026-08-10T00:00:00.000Z",
      upperBound: "2026-08-10T23:59:59.999Z",
    });
    expect(result.assets).toHaveLength(3);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(result.assets.some((asset) => asset.canonicalUrl.includes("99999"))).toBe(false);
    expect(result.status.value).toBe("UNKNOWN");
  });

  it("strictly excludes an out-of-scope sitemap publication after detail normalization", () => {
    const url =
      "https://studisantiimmobiliare.it/it/Vendite/molfetta/negozio/v000801/3907/";
    const result = normalizeStudiSantiDetail(
      sourceDocument("studisanti-out-of-scope-detail.html", url, "3907"),
    );
    expect(result.location).toMatchObject({ municipality: null, scope: "OUT_OF_SCOPE" });
  });

  it("freezes absence decisions when the sitemap contract changes", () => {
    const result = parseStudiSantiSitemap("<html><body>maintenance</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
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

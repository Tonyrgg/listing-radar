import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HttpResponse } from "@/lib/http/client";
import {
  enrichAdMaioraInventoryWithRest,
  normalizeAdMaioraDetail,
  parseAdMaioraInventoryHtml,
} from "@/lib/property-lifecycle/adapters/admaiora";
import {
  normalizeFuturaDetail,
  parseFuturaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/futura";
import {
  normalizeGarofaloDetail,
  parseGarofaloInventoryJson,
} from "@/lib/property-lifecycle/adapters/garofalo";
import {
  normalizeIconacasaDetail,
  parseIconacasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/iconacasa";
import {
  normalizeMomentoDetail,
  parseMomentoInventoryHtml,
} from "@/lib/property-lifecycle/adapters/momento";
import {
  normalizePuntoCasaDetail,
  parsePuntoCasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/puntocasa";
import {
  normalizeStudioCasaDetail,
  parseStudioCasaInventoryHtml,
} from "@/lib/property-lifecycle/adapters/studiocasa";
import {
  normalizeStudiSantiDetail,
  parseStudiSantiSitemap,
} from "@/lib/property-lifecycle/adapters/studisanti";
import {
  normalizeTrioDetail,
  parseTrioInventoryHtml,
} from "@/lib/property-lifecycle/adapters/trio";
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

describe("Ad Maiora V2 adapter", () => {
  it("extracts a 20-record golden public-sale inventory and joins stable WordPress IDs", () => {
    const parsed = parseAdMaioraInventoryHtml(fixture("admaiora-inventory.html"));
    expect(parsed.healthState).toBe("HEALTHY");
    expect(parsed.complete).toBe(true);
    expect(parsed.items).toHaveLength(20);
    expect(parsed.diagnostics.duplicateCount).toBe(0);

    const enriched = enrichAdMaioraInventoryWithRest(
      parsed.items,
      fixture("admaiora-rest.json"),
    );
    expect(enriched.unmatchedCount).toBe(0);
    expect(enriched.items).toHaveLength(20);
    expect(enriched.items[0]).toMatchObject({
      sourceKey: "17425",
      externalId: "17425",
      summary: {
        wordpressPostId: 17425,
        wordpressPublishedGmt: "2026-07-29T09:38:41",
      },
    });
  });

  it("does not call the first visible archive page complete when pagination remains", () => {
    const page = fixture("admaiora-inventory.html")
      .replace('data-v2-property-count="20"', 'data-v2-property-count="44"')
      .replace("</body>", '<a href="/vendita/page/8/">Ultimo</a></body>');
    const result = parseAdMaioraInventoryHtml(page);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 8 });
  });

  it("normalizes WordPress identity, explicit publication date, facts, and scoped media", () => {
    const url =
      "https://www.admaioraimmobiliare.it/immobile/elegante-trivani-ristrutturato-in-vendita-a-bitonto-zona-centro/";
    const result = normalizeAdMaioraDetail(
      sourceDocument("admaiora-active-detail.html", url, "17425"),
    );

    expect(result.source).toMatchObject({ externalId: "17425", agencyReference: "0954" });
    expect(result.commercial).toMatchObject({
      priceAmount: 170_000,
      surfaceSqm: 70,
      rooms: 3,
      bathrooms: 1,
      floor: "2",
    });
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      scope: "IN_SCOPE",
      precision: "APPROXIMATE_AREA",
    });
    expect(result.marketStart).toMatchObject({
      method: "WORDPRESS_JSON_LD_DATE_PUBLISHED",
      lowerBound: "2026-07-29T09:38:41.000Z",
      upperBound: "2026-07-29T09:38:41.000Z",
      confidence: 0.9,
    });
    expect(result.marketStart.evidence[0]?.metadata).toMatchObject({
      dateModifiedIgnoredForStart: "2026-08-04T17:17:51.000Z",
    });
    expect(result.assets).toHaveLength(4);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(result.assets.some((asset) => asset.canonicalUrl.includes("unrelated"))).toBe(false);
    expect(result.status.value).toBe("UNKNOWN");
  });

  it("strictly excludes Santo Spirito after detail normalization", () => {
    const url =
      "https://www.admaioraimmobiliare.it/immobile/villa-indipendente-di-nuova-costruzione-con-ampio-giardino-privato-a-santo-spirito/";
    const result = normalizeAdMaioraDetail(
      sourceDocument("admaiora-out-of-scope-detail.html", url, "17294"),
    );
    expect(result.location.scope).toBe("OUT_OF_SCOPE");
  });

  it("freezes absence decisions when sale archive markers disappear", () => {
    const result = parseAdMaioraInventoryHtml("<html><body>maintenance</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Studio Casa Bitonto V2 adapter", () => {
  it("extracts a 20-sale portal golden inventory and excludes rentals", () => {
    const result = parseStudioCasaInventoryHtml(fixture("studiocasa-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.diagnostics).toMatchObject({
      expectedCount: 21,
      pagesVisited: 1,
      expectedPages: 1,
    });
    expect(result.items.some((item) => item.externalId === "52803979")).toBe(false);
    expect(result.items[0]).toMatchObject({
      sourceKey: "54520194",
      summary: {
        partnerId: 36397664,
        portalReference: "SC-101",
        priceAmount: 109_000,
      },
    });
  });

  it("does not call an incomplete first portal page healthy", () => {
    const paginated = fixture("studiocasa-inventory.html")
      .replace('\\"total\\":21', '\\"total\\":53')
      .replace('\\"totalPages\\":1', '\\"totalPages\\":3');
    const result = parseStudioCasaInventoryHtml(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 3 });
  });

  it("normalizes portal facts while keeping modification separate from market start", () => {
    const url = "https://www.casa.it/immobili/54520194/";
    const result = normalizeStudioCasaDetail(
      sourceDocument("studiocasa-active-detail.html", url, "54520194"),
    );

    expect(result.source).toMatchObject({
      externalId: "54520194",
      agencyReference: "SC-101",
      transactionType: "SALE",
    });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 109_000,
      surfaceSqm: 112,
      rooms: 3,
      bathrooms: 1,
      floor: "1Â° piano",
    });
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Corso Vittorio Emanuele",
      scope: "IN_SCOPE",
      precision: "STREET_ONLY",
    });
    expect(result.status.value).toBe("UNKNOWN");
    expect(result.assets).toHaveLength(2);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(result.marketStart).toMatchObject({
      method: "CRAWLER_FIRST_SEEN",
      lowerBound: null,
      confidence: 0.25,
    });
    expect(result.provenance).toMatchObject({
      portalModifiedAt: "2026-08-04T00:00:00.000Z",
      portalModifiedIgnoredForMarketStart: true,
      sourceCreatedAtUnavailable: true,
      publisherContactDataExcluded: true,
    });
  });

  it("strictly excludes a portal listing in Santo Spirito", () => {
    const url = "https://www.casa.it/immobili/54121668/";
    const result = normalizeStudioCasaDetail(
      sourceDocument("studiocasa-out-of-scope-detail.html", url, "54121668"),
    );
    expect(result.location).toMatchObject({ scope: "OUT_OF_SCOPE", municipality: null });
  });

  it("freezes absence decisions when Casa.it state markers disappear", () => {
    const result = parseStudioCasaInventoryHtml("<html><body>challenge</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Futura Immobiliare V2 adapter", () => {
  it("extracts a complete 20-record Agesta golden sale inventory", () => {
    const result = parseFuturaInventoryHtml(fixture("futura-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      sourceKey: "2587000",
      externalId: "2587000",
      summary: {
        agencyReference: "10116RA46927",
        municipality: "Bitonto",
        priceAmount: 179_000,
        surfaceSqm: 94,
      },
    });
  });

  it("does not call an incomplete Agesta page healthy", () => {
    const paginated = fixture("futura-inventory.html")
      .replace("Sono stati trovati 20", "Sono stati trovati 49")
      .replace(
        "</select>",
        '<option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select>',
      );
    const result = parseFuturaInventoryHtml(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 6 });
  });

  it("normalizes Agesta identity, facts, publication cycle, and original gallery", () => {
    const url =
      "https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2587000&language=ita";
    const result = normalizeFuturaDetail(
      sourceDocument("futura-active-detail.html", url, "2587000"),
    );

    expect(result.source).toMatchObject({
      externalId: "2587000",
      agencyReference: "10116RA46927",
      transactionType: "SALE",
    });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 179_000,
      surfaceSqm: 94,
      rooms: 4,
      bedrooms: 2,
      bathrooms: 1,
      floor: "2",
    });
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Via Cavallotti",
      scope: "IN_SCOPE",
      precision: "STREET_ONLY",
    });
    expect(result.marketStart).toMatchObject({
      method: "AGESTA_ARTICLE_PUBLISHED_DATE",
      lowerBound: "2026-08-04T00:00:00.000Z",
      upperBound: "2026-08-04T23:59:59.999Z",
      confidence: 0.85,
    });
    expect(result.marketStart.evidence[0]?.metadata).toMatchObject({
      articleModifiedIgnoredForStart: "2026-08-04",
    });
    expect(result.assets).toHaveLength(3);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(
      result.assets.every((asset) =>
        asset.canonicalUrl.startsWith(
          "https://agestanet.risorseimmobiliari.it/public/annunci/10116/2587000/",
        ),
      ),
    ).toBe(true);
    expect(result.status.value).toBe("UNKNOWN");
  });

  it("strictly excludes a Futura publication in Bari/Palese", () => {
    const url =
      "https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2549038&language=ita";
    const result = normalizeFuturaDetail(
      sourceDocument("futura-out-of-scope-detail.html", url, "2549038"),
    );
    expect(result.location).toMatchObject({ scope: "OUT_OF_SCOPE", municipality: null });
  });

  it("freezes absence decisions when the Agesta inventory structure disappears", () => {
    const result = parseFuturaInventoryHtml("<html><body>maintenance</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Garofalo Immobiliare V2 adapter", () => {
  it("extracts a complete 20-record Flazio golden sale inventory using numeric identity", () => {
    const result = parseGarofaloInventoryJson(fixture("garofalo-inventory.json"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      sourceKey: "16104",
      externalId: "16104",
      summary: {
        agencyReference: "I69",
        municipality: "Bitonto",
        priceAmount: 95_000,
        surfaceSqm: 120,
      },
    });
    expect(result.items.find((item) => item.externalId === "14297")?.summary).toMatchObject({
      agencyReference: "Q95",
      sold: true,
    });
  });

  it("does not call one API page healthy when the reported total requires pagination", () => {
    const paginated = fixture("garofalo-inventory.json").replace(
      '"properties_count_all_filtered": "20"',
      '"properties_count_all_filtered": "140"',
    );
    const result = parseGarofaloInventoryJson(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 2 });
  });

  it("normalizes Flazio facts, source creation, and original-only gallery media", () => {
    const url =
      "https://garofaloimmobiliare.com/realestate-detail/reid/14164/largo-teatro-umberto-4-vani";
    const result = normalizeGarofaloDetail(
      sourceDocument("garofalo-active-detail.json", url, "14164"),
    );

    expect(result.source).toMatchObject({
      externalId: "14164",
      agencyReference: "LT8",
      transactionType: "SALE",
    });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 55_000,
      surfaceSqm: 85,
      rooms: 4,
      bathrooms: 1,
      floor: "1",
    });
    expect(result.commercial.description).not.toMatch(/080|garofaloimmobiliare\.com/);
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Largo Teatro Umberto",
      scope: "IN_SCOPE",
      precision: "STREET_ONLY",
    });
    expect(result.marketStart).toMatchObject({
      method: "FLAZIO_PROPERTY_CREATED_AT",
      lowerBound: "2026-04-01T00:00:00.000Z",
      upperBound: "2026-04-01T23:59:59.999Z",
      confidence: 0.88,
    });
    expect(result.marketStart.evidence[0]?.metadata).toMatchObject({
      sourceUpdatedAtIgnoredForStart: "2026-04-01 08:44:15",
    });
    expect(result.assets).toHaveLength(2);
    expect(result.assets.some((asset) => asset.kind === "FLOORPLAN")).toBe(true);
    expect(
      result.assets.every(
        (asset) =>
          asset.canonicalUrl.startsWith("https://globaluserfiles.com/media/4350_") &&
          !asset.canonicalUrl.includes("/v1/"),
      ),
    ).toBe(true);
    expect(result.status.value).toBe("UNKNOWN");
    expect(result.provenance).toMatchObject({
      categoryPrefixedAgencyReferenceNotChronological: true,
      transformedV1MediaExcluded: true,
      publisherContactDataExcluded: true,
    });
  });

  it("uses the deterministic Flazio sold flag", () => {
    const url =
      "https://garofaloimmobiliare.com/realestate-detail/reid/14297/via-giovanna-da-durazzo-4-vani-cantinola";
    const result = normalizeGarofaloDetail(
      sourceDocument("garofalo-sold-detail.json", url, "14297"),
    );
    expect(result.status.value).toBe("SOLD");
    expect(result.status.evidence[0]?.extractionMethod).toBe("FLAZIO_SOLD_FLAG");
    expect(result.location.streetName).toBe("Via Giovanna da Durazzo");
  });

  it("strictly excludes an out-of-scope Bari publication", () => {
    const url = "https://garofaloimmobiliare.com/realestate-detail/reid/14368/via-savona-villa";
    const result = normalizeGarofaloDetail(
      sourceDocument("garofalo-out-of-scope-detail.json", url, "14368"),
    );
    expect(result.location).toMatchObject({ scope: "OUT_OF_SCOPE", municipality: null });
  });

  it("freezes absence decisions when the Flazio API structure disappears", () => {
    const result = parseGarofaloInventoryJson('{"result":false,"message":"maintenance"}');
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Trio Casa V2 adapter", () => {
  it("extracts a complete 10-record TrovaCasa agency sale inventory", () => {
    const result = parseTrioInventoryHtml(fixture("trio-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toMatchObject({
      sourceKey: "72626464",
      externalId: "72626464",
      summary: {
        priceAmount: 189_000,
        surfaceSqm: 103,
        rooms: 3,
        portalPublisherId: 92459,
      },
    });
  });

  it("does not call the first portal page healthy when a next page remains", () => {
    const paginated = fixture("trio-inventory.html")
      .replace("10 case in vendita", "25 case in vendita")
      .replace("</head>", '<link rel="next" href="?pagina=2"></head>');
    const result = parseTrioInventoryHtml(paginated);
    expect(result.healthState).toBe("DEGRADED");
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toMatchObject({ pagesVisited: 1, expectedPages: 2 });
  });

  it("normalizes portal facts while preserving uncertain market start", () => {
    const url = "https://www.trovacasa.it/annunci/ba-tc-92459-72461820";
    const result = normalizeTrioDetail(
      sourceDocument("trio-active-detail.html", url, "72461820"),
    );

    expect(result.source).toMatchObject({
      externalId: "72461820",
      agencyReference: null,
      transactionType: "SALE",
    });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 145_000,
      surfaceSqm: 100,
      rooms: 3,
      bathrooms: 1,
    });
    expect(result.commercial.description).not.toMatch(/080|example\.invalid/);
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Via Ammiraglio Vacca",
      streetNumber: "28",
      precision: "EXACT_ADDRESS",
      scope: "IN_SCOPE",
    });
    expect(result.marketStart).toMatchObject({
      method: "CRAWLER_FIRST_SEEN",
      lowerBound: null,
      confidence: 0.25,
    });
    expect(result.assets).toHaveLength(2);
    expect(
      result.assets.every((asset) =>
        asset.canonicalUrl.startsWith("https://pic.trovacasa.it/image/"),
      ),
    ).toBe(true);
    expect(result.status.value).toBe("UNKNOWN");
    expect(result.provenance).toMatchObject({
      upstreamPortalReference: "130992652",
      upstreamPortalReferenceNotAgencyCode: true,
      publisherContactDataExcluded: true,
    });
  });

  it("strictly excludes a Bisceglie portal publication", () => {
    const url = "https://www.trovacasa.it/annunci/bt-tc-92459-72023818";
    const result = normalizeTrioDetail(
      sourceDocument("trio-out-of-scope-detail.html", url, "72023818"),
    );
    expect(result.location).toMatchObject({ scope: "OUT_OF_SCOPE", municipality: null });
  });

  it("freezes absence decisions when publisher markers disappear", () => {
    const result = parseTrioInventoryHtml("<html><body>maintenance</body></html>");
    expect(result.healthState).toBe("STRUCTURE_CHANGED");
    expect(result.complete).toBe(false);
  });
});

describe("Momento Casa V2 adapter", () => {
  it("extracts the complete four-record TrovaCasa publisher-sale baseline", () => {
    const result = parseMomentoInventoryHtml(fixture("momento-inventory.html"));
    expect(result.healthState).toBe("HEALTHY");
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toMatchObject({
      sourceKey: "70534497",
      externalId: "70534497",
      summary: {
        priceAmount: 147_000,
        surfaceSqm: 115,
        rooms: 4,
        portalPublisherId: 96100,
      },
    });
  });

  it("rejects cross-agency gallery tokens from the publication baseline", () => {
    const contaminated = fixture("momento-inventory.html").replace(
      "X_96100_70534497_1877995969",
      "X_92459_70534497_1877995969",
    );
    const result = parseMomentoInventoryHtml(contaminated);
    expect(result.complete).toBe(false);
    expect(result.diagnostics.parseErrorCount).toBe(1);
  });

  it("normalizes exact civic and portal evidence without inventing publication start", () => {
    const url = "https://www.trovacasa.it/annunci/ba-tc-96100-70534492";
    const result = normalizeMomentoDetail(
      sourceDocument("momento-active-detail.html", url, "70534492"),
    );

    expect(result).toMatchObject({ adapterKey: "momento" });
    expect(result.source).toMatchObject({
      agencySlug: "momento-casa-bitonto",
      externalId: "70534492",
      agencyReference: null,
      transactionType: "SALE",
    });
    expect(result.commercial).toMatchObject({
      propertyType: "Appartamento",
      priceAmount: 110_000,
      surfaceSqm: 100,
      rooms: 4,
      bathrooms: 2,
    });
    expect(result.commercial.description).not.toMatch(/080|example\.invalid/);
    expect(result.location).toMatchObject({
      municipality: "Bitonto",
      streetName: "Via Ammiraglio Vacca",
      streetNumber: "56e",
      precision: "EXACT_ADDRESS",
      scope: "IN_SCOPE",
    });
    expect(result.marketStart).toMatchObject({
      method: "CRAWLER_FIRST_SEEN",
      lowerBound: null,
      confidence: 0.25,
    });
    expect(result.assets).toHaveLength(5);
    expect(result.status.value).toBe("UNKNOWN");
    expect(result.provenance).toMatchObject({
      trovaCasaAgencyId: 96100,
      upstreamPortalReference: "127156489",
      sourceCreatedAtUnavailable: true,
    });
  });

  it("freezes absence decisions when the Momento publisher contract disappears", () => {
    const result = parseMomentoInventoryHtml("<html><body>maintenance</body></html>");
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

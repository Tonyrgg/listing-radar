import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import type { HttpResponse } from "@/lib/http/client";
import { normalizeIconacasaDetail } from "@/lib/property-lifecycle/adapters/iconacasa";
import { processListingAssets } from "@/lib/property-lifecycle/assets/pipeline";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function listingFixture() {
  const url =
    "https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento";
  const body = readFileSync(
    join(
      process.cwd(),
      "tests",
      "fixtures",
      "property-lifecycle",
      "iconacasa-active-detail.html",
    ),
    "utf8",
  );
  const response: HttpResponse = {
    body,
    headers: new Headers(),
    ok: true,
    status: 200,
    url,
  };
  return normalizeIconacasaDetail({
    item: { sourceKey: "45212", externalId: "45212", url, summary: {} },
    response,
    observedAt: "2026-08-19T09:00:00.000Z",
  });
}

describe("Property Lifecycle media pipeline", () => {
  it("stores one small preview while preserving fingerprints of all source photos", async()=>{
    const listing=listingFixture();
    listing.assets=["one","two","three"].map(name=>({kind:"IMAGE" as const,url:`https://media.example/${name}.png`,canonicalUrl:`https://media.example/${name}.png`,sourceRecordedAt:null,dateEvidenceMethod:null,metadata:{}}));
    const photo=await sharp({create:{width:1600,height:1200,channels:3,background:{r:120,g:150,b:180}}}).png().toBuffer();
    const result=await processListingAssets(listing,{requestDelayMs:0,representativeImageCount:2,fetcher:async()=>new Response(photo)});
    expect(result.assets).toHaveLength(3);
    expect(result.assets.every(asset=>!!asset.perceptualHash)).toBe(true);
    const previews=result.assets.filter(asset=>asset.representativeThumbnail);
    expect(previews).toHaveLength(1);
    const preview=previews[0].representativeThumbnail;
    if(!preview)throw new Error("Preview missing");
    const metadata=await sharp(preview).metadata();
    expect(metadata.width).toBe(640);expect(metadata.height).toBe(480);expect(metadata.format).toBe("webp");
  });
  it("creates content hashes, perceptual hashes, metadata, and a compact representative", async () => {
    const listing = listingFixture();
    listing.assets = [
      {
        kind: "IMAGE",
        url: "https://media.example/property/front.png",
        canonicalUrl: "https://media.example/property/front.png",
        sourceRecordedAt: null,
        dateEvidenceMethod: null,
        metadata: {},
      },
    ];
    const result = await processListingAssets(listing, {
      requestDelayMs: 0,
      fetcher: async () =>
        new Response(ONE_BY_ONE_PNG, {
          status: 200,
          headers: {
            "content-type": "image/png",
            etag: '"fixture-etag"',
            "last-modified": "Wed, 19 Aug 2026 09:00:00 GMT",
          },
        }),
    });

    expect(result.warnings).toEqual([]);
    expect(result.assets[0]).toMatchObject({
      classification: "IMAGE",
      width: 1,
      height: 1,
      format: "png",
      etag: '"fixture-etag"',
      exif: null,
    });
    expect(result.assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.assets[0]?.perceptualHash).toMatch(/^[01]{64}$/);
    expect(result.assets[0]?.representativeThumbnail?.byteLength).toBeGreaterThan(0);
  });

  it("classifies and fingerprints floorplans without retaining them as primary photos", async () => {
    const listing = listingFixture();
    listing.assets = [
      {
        kind: "IMAGE",
        url: "https://media.example/property/planimetria.png",
        canonicalUrl: "https://media.example/property/planimetria.png",
        sourceRecordedAt: null,
        dateEvidenceMethod: null,
        metadata: {},
      },
    ];
    const result = await processListingAssets(listing, {
      requestDelayMs: 0,
      fetcher: async () => new Response(ONE_BY_ONE_PNG, { status: 200 }),
    });
    expect(result.assets[0]?.classification).toBe("FLOORPLAN");
    expect(result.assets[0]?.perceptualHash).toMatch(/^[01]{64}$/);
    expect(result.assets[0]?.representativeThumbnail).toBeNull();
  });

  it("bounds downloads and records failures without retaining bodies", async () => {
    const listing = listingFixture();
    listing.assets = listing.assets.slice(0, 1);
    const result = await processListingAssets(listing, {
      maxBytesPerAsset: 2,
      requestDelayMs: 0,
      fetcher: async () =>
        new Response(ONE_BY_ONE_PNG, {
          status: 200,
          headers: { "content-length": String(ONE_BY_ONE_PNG.byteLength) },
        }),
    });
    expect(result.assets).toEqual([]);
    expect(result.warnings[0]).toContain("declared body exceeds 2 bytes");
  });
});

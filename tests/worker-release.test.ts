import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  getLatestWorkerRelease,
  WORKER_RELEASE_API_URL,
  WORKER_UPDATE_MANIFEST_ASSET,
} from "@/lib/worker-release";

const repository = "Tonyrgg/listing-radar";
const assetUrl = (name: string, version = "1.2.3") =>
  `https://github.com/${repository}/releases/download/property-worker-v${version}/${name}`;

function releaseFixture(overrides: Record<string, unknown> = {}) {
  const chunk = Buffer.from("installer verificato");
  const manifest = {
    version: "1.2.3",
    fileName: "Property Data Worker Setup 1.2.3.exe",
    installerAsset: "Property-Data-Worker-Setup-1.2.3.exe",
    size: chunk.length,
    sha256: createHash("sha256").update(chunk).digest("hex"),
    releaseDate: "2026-08-29T10:00:00.000Z",
    chunks: [{
      name: "property-worker-1.2.3-part-000.bin",
      size: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
    }],
    ...overrides,
  };
  const manifestUrl = assetUrl(WORKER_UPDATE_MANIFEST_ASSET);
  const assets = [
    { name: WORKER_UPDATE_MANIFEST_ASSET, size: Buffer.byteLength(JSON.stringify(manifest)), browser_download_url: manifestUrl },
    { name: manifest.installerAsset, size: manifest.size, browser_download_url: assetUrl(manifest.installerAsset) },
    ...manifest.chunks.map((part) => ({ name: part.name, size: part.size, browser_download_url: assetUrl(part.name) })),
  ];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input) === WORKER_RELEASE_API_URL) return Response.json({ tag_name: "property-worker-v1.2.3", assets });
    if (String(input) === manifestUrl) return Response.json(manifest);
    return new Response("Not found", { status: 404 });
  });
  return { fetchMock, manifest };
}

describe("canale pubblico release worker", () => {
  it("espone l'installer GitHub dopo aver verificato manifest e asset", async () => {
    const fixture = releaseFixture();
    await expect(getLatestWorkerRelease(fixture.fetchMock as unknown as typeof fetch)).resolves.toEqual({
      version: "1.2.3",
      releaseDate: fixture.manifest.releaseDate,
      size: fixture.manifest.size,
      sha256: fixture.manifest.sha256,
      downloadUrl: assetUrl(fixture.manifest.installerAsset),
    });
    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rifiuta asset esterni al repository autorizzato", async () => {
    const fixture = releaseFixture();
    const original = fixture.fetchMock;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const response = await original(input);
      if (String(input) !== WORKER_RELEASE_API_URL) return response;
      const release = await response.json();
      release.assets[0].browser_download_url = "https://example.com/property-worker-manifest.json";
      return Response.json(release);
    });
    await expect(getLatestWorkerRelease(fetchMock as unknown as typeof fetch)).rejects.toThrow("non autorizzato");
  });

  it("rifiuta manifest le cui parti non ricompongono la dimensione dichiarata", async () => {
    const fixture = releaseFixture({ size: 999 });
    await expect(getLatestWorkerRelease(fixture.fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "somma delle parti",
    );
  });
});

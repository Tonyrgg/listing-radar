import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DesktopUpdater,
  WORKER_RELEASE_API_URL,
  WORKER_UPDATE_MANIFEST_ASSET,
  type UpdateManifest,
} from "../src/desktop/updater.js";

const assetUrl = (name: string, version: string) =>
  `https://github.com/Tonyrgg/listing-radar/releases/download/property-worker-v${version}/${name}`;

function updateFixture(chunks: Buffer[], version = "1.1.0") {
  const complete = Buffer.concat(chunks);
  const manifest: UpdateManifest = {
    version,
    fileName: `Property Data Worker Setup ${version}.exe`,
    installerAsset: `Property-Data-Worker-Setup-${version}.exe`,
    size: complete.length,
    sha256: createHash("sha256").update(complete).digest("hex"),
    releaseDate: new Date().toISOString(),
    chunks: chunks.map((chunk, index) => ({
      name: `property-worker-${version}-part-${String(index).padStart(3, "0")}.bin`,
      size: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
    })),
  };
  const manifestBody = JSON.stringify(manifest);
  const assets = [
    { name: WORKER_UPDATE_MANIFEST_ASSET, size: Buffer.byteLength(manifestBody) },
    { name: manifest.installerAsset, size: manifest.size },
    ...manifest.chunks.map(({ name, size }) => ({ name, size })),
  ].map((asset) => ({ ...asset, browser_download_url: assetUrl(asset.name, version) }));
  const remoteBodies = new Map<string, BodyInit>([
    [assetUrl(WORKER_UPDATE_MANIFEST_ASSET, version), manifestBody],
    ...manifest.chunks.map((chunk, index) => [assetUrl(chunk.name, version), Uint8Array.from(chunks[index]!)] as const),
  ]);
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === WORKER_RELEASE_API_URL) {
      return Response.json({ tag_name: `property-worker-v${version}`, assets });
    }
    const body = remoteBodies.get(url);
    return body == null ? new Response("Not found", { status: 404 }) : new Response(body);
  });
  const fetchImpl = fetchMock as unknown as typeof fetch;
  return { complete, fetchImpl, fetchMock, manifest };
}

describe("aggiornamenti desktop", () => {
  it("non tenta aggiornamenti nella versione di sviluppo", async () => {
    const onState = vi.fn();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: false, updateDirectory: "C:\\Temp\\Updates",
      isWorkerActive: () => false, quitApp: vi.fn(), onState, fetchImpl,
    });
    expect(updater.snapshot()).toMatchObject({ status: "unavailable", currentVersion: "1.0.0" });
    await expect(updater.check()).resolves.toMatchObject({ status: "unavailable" });
    await expect(updater.download()).rejects.toThrow("app installata");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("confronta correttamente le versioni numeriche", async () => {
    const { compareVersions } = await import("../src/desktop/updater.js");
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "2.0.0")).toBe(-1);
  });

  it("scarica da GitHub e riutilizza le parti valide senza nuovo traffico", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-updater-"));
    const fixture = updateFixture([Buffer.from("prima parte dell'installer"), Buffer.from("seconda parte dell'installer")]);
    const createUpdater = () => new DesktopUpdater({
      currentVersion: "1.0.0", packaged: true, updateDirectory,
      isWorkerActive: () => false, quitApp: vi.fn(), onState: vi.fn(), fetchImpl: fixture.fetchImpl,
    });

    try {
      const firstUpdater = createUpdater();
      await firstUpdater.check();
      await expect(firstUpdater.download()).resolves.toMatchObject({ status: "downloaded" });
      const installerPath = path.join(updateDirectory, fixture.manifest.version, fixture.manifest.fileName);
      await expect(readFile(installerPath)).resolves.toEqual(fixture.complete);

      await rm(installerPath);
      const secondUpdater = createUpdater();
      await secondUpdater.check();
      await expect(secondUpdater.download()).resolves.toMatchObject({ status: "downloaded" });
      for (const chunk of fixture.manifest.chunks) {
        expect(fixture.fetchMock.mock.calls.filter(([url]) => String(url) === assetUrl(chunk.name, fixture.manifest.version))).toHaveLength(1);
      }
      expect(fixture.fetchMock.mock.calls.filter(([url]) => String(url) === WORKER_RELEASE_API_URL)).toHaveLength(2);
    } finally {
      await rm(updateDirectory, { recursive: true, force: true });
    }
  });

  it("interrompe un download attivo e rimuove l'installer parziale", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-updater-cancel-"));
    const fixture = updateFixture([Buffer.from("installer da interrompere")], "1.2.0");
    const originalFetch = fixture.fetchImpl;
    let releaseChunk: (() => void) | null = null;
    const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === assetUrl(fixture.manifest.chunks[0]!.name, fixture.manifest.version)) await chunkGate;
      return originalFetch(input, init);
    }) as unknown as typeof fetch;
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: true, updateDirectory,
      isWorkerActive: () => false, quitApp: vi.fn(), onState: vi.fn(), fetchImpl,
    });

    try {
      await updater.check();
      const pending = updater.download();
      await vi.waitFor(() => expect(updater.snapshot().status).toBe("downloading"));
      expect(updater.cancelDownload()).toBe(true);
      (releaseChunk as (() => void) | null)?.();
      await expect(pending).resolves.toMatchObject({ status: "available", message: expect.stringContaining("interrotto") });
      await expect(readFile(path.join(updateDirectory, fixture.manifest.version, fixture.manifest.fileName))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(updateDirectory, { recursive: true, force: true });
    }
  });

  it("rifiuta release incomplete e termina il controllo quando la rete non risponde", async () => {
    const never = new Promise<Response>(() => undefined);
    const fetchImpl = vi.fn(() => never) as unknown as typeof fetch;
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: true, updateDirectory: "C:\\Temp\\Updates",
      isWorkerActive: () => false, quitApp: vi.fn(), onState: vi.fn(), fetchImpl, operationTimeoutMs: 10,
    });

    const first = updater.check();
    const second = updater.check();
    await expect(Promise.all([first, second])).resolves.toEqual(expect.arrayContaining([expect.objectContaining({
      status: "error", message: expect.stringContaining("tempo massimo superato"),
    })]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(updater.snapshot().status).not.toBe("checking");
  });
});

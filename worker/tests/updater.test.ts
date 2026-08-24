import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { DesktopUpdater } from "../src/desktop/updater.js";

describe("aggiornamenti desktop", () => {
  it("non tenta aggiornamenti nella versione di sviluppo", async () => {
    const onState = vi.fn();
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: false, supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-key-not-real", updateDirectory: "C:\\Temp\\Updates",
      isWorkerActive: () => false, quitApp: vi.fn(), onState,
    });
    expect(updater.snapshot()).toMatchObject({ status: "unavailable", currentVersion: "1.0.0" });
    await expect(updater.check()).resolves.toMatchObject({ status: "unavailable" });
    await expect(updater.download()).rejects.toThrow("app installata");
  });

  it("confronta correttamente le versioni numeriche", async () => {
    const { compareVersions } = await import("../src/desktop/updater.js");
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "2.0.0")).toBe(-1);
  });

  it("riutilizza le parti valide gia scaricate senza nuovo egress", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-updater-"));
    const firstChunk = Buffer.from("prima parte dell'installer");
    const secondChunk = Buffer.from("seconda parte dell'installer");
    const complete = Buffer.concat([firstChunk, secondChunk]);
    const manifest = {
      version: "1.1.0",
      fileName: "setup.exe",
      size: complete.length,
      sha256: createHash("sha256").update(complete).digest("hex"),
      releaseDate: new Date().toISOString(),
      chunks: [firstChunk, secondChunk].map((chunk, index) => ({
        path: `releases/1.1.0/part-00${index}.bin`,
        size: chunk.length,
        sha256: createHash("sha256").update(chunk).digest("hex"),
      })),
    };
    const remoteFiles = new Map([
      ["latest.json", Buffer.from(JSON.stringify(manifest))],
      [manifest.chunks[0]!.path, firstChunk],
      [manifest.chunks[1]!.path, secondChunk],
    ]);
    const download = vi.fn(async (remotePath: string) => {
      const body = remoteFiles.get(remotePath);
      return body
        ? { data: new Blob([Uint8Array.from(body)]), error: null }
        : { data: null, error: new Error(`File remoto mancante: ${remotePath}`) };
    });
    const storageClient = {
      storage: { from: vi.fn(() => ({ download })) },
    } as unknown as Pick<SupabaseClient, "storage">;
    const createUpdater = () => new DesktopUpdater({
      currentVersion: "1.0.0", packaged: true, supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-key-not-real", updateDirectory,
      isWorkerActive: () => false, quitApp: vi.fn(), onState: vi.fn(), storageClient,
    });

    try {
      const firstUpdater = createUpdater();
      await firstUpdater.check();
      await expect(firstUpdater.download()).resolves.toMatchObject({ status: "downloaded" });
      const installerPath = path.join(updateDirectory, manifest.version, manifest.fileName);
      await expect(readFile(installerPath)).resolves.toEqual(complete);

      await rm(installerPath);
      const secondUpdater = createUpdater();
      await secondUpdater.check();
      await expect(secondUpdater.download()).resolves.toMatchObject({ status: "downloaded" });
      expect(download.mock.calls.filter(([remotePath]) => remotePath === manifest.chunks[0]!.path)).toHaveLength(1);
      expect(download.mock.calls.filter(([remotePath]) => remotePath === manifest.chunks[1]!.path)).toHaveLength(1);
      expect(download.mock.calls.filter(([remotePath]) => remotePath === "latest.json")).toHaveLength(2);
    } finally {
      await rm(updateDirectory, { recursive: true, force: true });
    }
  });

  it("interrompe un download attivo e rimuove l'installer parziale", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-updater-cancel-"));
    const chunk = Buffer.from("installer da interrompere");
    const manifest = {
      version: "1.2.0",
      fileName: "setup.exe",
      size: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
      releaseDate: new Date().toISOString(),
      chunks: [{
        path: "releases/1.2.0/part-000.bin",
        size: chunk.length,
        sha256: createHash("sha256").update(chunk).digest("hex"),
      }],
    };
    let releaseChunk: (() => void) | null = null;
    const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
    const download = vi.fn(async (remotePath: string) => {
      if (remotePath === "latest.json") return { data: new Blob([JSON.stringify(manifest)]), error: null };
      await chunkGate;
      return { data: new Blob([Uint8Array.from(chunk)]), error: null };
    });
    const storageClient = {
      storage: { from: vi.fn(() => ({ download })) },
    } as unknown as Pick<SupabaseClient, "storage">;
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: true, supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-key-not-real", updateDirectory,
      isWorkerActive: () => false, quitApp: vi.fn(), onState: vi.fn(), storageClient,
    });

    try {
      await updater.check();
      const pending = updater.download();
      await vi.waitFor(() => expect(updater.snapshot().status).toBe("downloading"));
      expect(updater.cancelDownload()).toBe(true);
      releaseChunk?.();
      await expect(pending).resolves.toMatchObject({
        status: "available",
        message: expect.stringContaining("interrotto"),
      });
      await expect(readFile(path.join(updateDirectory, manifest.version, manifest.fileName))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(updateDirectory, { recursive: true, force: true });
    }
  });
});

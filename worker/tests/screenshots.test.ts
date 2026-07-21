import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isDiagnosticScreenshotPath, removeDiagnosticScreenshots } from "../src/services/screenshots.js";

describe("pulizia screenshot di una lavorazione", () => {
  it("rimuove soltanto PNG esplicitamente elencati dentro la cartella diagnostica", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "property-worker-screenshots-"));
    const root = path.join(base, "errors");
    const inside = path.join(root, "job-error.png");
    const outside = path.join(base, "outside.png");
    const wrongExtension = path.join(root, "notes.txt");

    try {
      await mkdir(root, { recursive: true });
      await Promise.all([
        writeFile(inside, "inside"),
        writeFile(outside, "outside"),
        writeFile(wrongExtension, "notes"),
      ]);

      expect(isDiagnosticScreenshotPath(root, inside)).toBe(true);
      expect(isDiagnosticScreenshotPath(root, outside)).toBe(false);
      expect(isDiagnosticScreenshotPath(root, wrongExtension)).toBe(false);

      const result = await removeDiagnosticScreenshots(root, [inside, inside, outside, wrongExtension]);
      expect(result).toEqual({ removed: 1, skipped: 2, failed: [] });
      await expect(access(inside)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(outside)).resolves.toBeUndefined();
      await expect(access(wrongExtension)).resolves.toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("è idempotente quando il file è già assente", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "property-worker-empty-screenshots-"));
    try {
      await expect(removeDiagnosticScreenshots(root, [path.join(root, "missing.png")]))
        .resolves.toEqual({ removed: 0, skipped: 0, failed: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

function safeSegment(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
}

export async function captureDiagnosticScreenshot(
  page: Page,
  directory: string,
  jobId: string,
  reason: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeSegment(jobId)}-${safeSegment(reason)}.png`;
  const filePath = path.resolve(directory, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function pruneDiagnosticScreenshots(directory: string, retentionDays: number): Promise<number> {
  await mkdir(directory, { recursive: true });
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let removed = 0;
  for (const name of await readdir(directory)) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    const filePath = path.resolve(directory, name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs < cutoff) {
      await unlink(filePath);
      removed += 1;
    }
  }
  return removed;
}

export function isDiagnosticScreenshotPath(directory: string, candidatePath: string): boolean {
  if (path.extname(candidatePath).toLowerCase() !== ".png") return false;
  const root = path.resolve(directory);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export async function removeDiagnosticScreenshots(
  directory: string,
  candidatePaths: string[],
): Promise<{ removed: number; skipped: number; failed: string[] }> {
  let removed = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const candidatePath of new Set(candidatePaths)) {
    if (!isDiagnosticScreenshotPath(directory, candidatePath)) {
      skipped += 1;
      continue;
    }
    try {
      await unlink(path.resolve(candidatePath));
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      failed.push(candidatePath);
    }
  }

  return { removed, skipped, failed };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => path.resolve(process.cwd(), "src", ...parts);

describe("desktop retry monitor", () => {
  it("mostra contatore e timer per tutte le tipologie di run", async () => {
    const [html, renderer] = await Promise.all([
      readFile(source("desktop", "renderer", "index.html"), "utf8"),
      readFile(source("desktop", "renderer", "renderer.js"), "utf8"),
    ]);

    expect(html).toContain('id="retryMonitor"');
    expect(html).toContain('id="retryMonitorAttempts"');
    expect(html).toContain('id="retryMonitorTimer"');
    for (const runType of ["import", "street", "network", "requests", "mandates"]) {
      expect(renderer).toContain(`${runType}:`);
    }
    expect(renderer).toContain("renderRetryMonitor();");
    expect(renderer).toContain("nextRetryAt");
  });

  it("porta il worker davanti quando una run richiede attenzione", async () => {
    const main = await readFile(source("desktop", "main.ts"), "utf8");

    expect(main).toContain("function bringWorkerToFront()");
    expect(main).toContain("mainWindow.restore()");
    expect(main).toContain("mainWindow.show()");
    expect(main).toContain("mainWindow.moveTop()");
    expect(main).toContain('mainWindow.setAlwaysOnTop(true, "floating")');
    expect(main).toContain("bringWorkerToFront();");
  });
});

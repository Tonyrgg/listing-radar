import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => path.resolve(process.cwd(), "src", ...parts);

describe("configurazione e controllo archivio desktop", () => {
  it("conserva il riferimento al form oltre il primo await", async () => {
    const renderer = await readFile(source("desktop", "renderer", "renderer.js"), "utf8");
    expect(renderer).toContain("const form = event.currentTarget");
    expect(renderer).toContain("new FormData(form)");
    expect(renderer).not.toContain("new FormData(event.currentTarget)");
  });

  it("controlla la tabella senza dipendere da colonne storiche", async () => {
    const repository = await readFile(source("services", "repository.ts"), "utf8");
    expect(repository).toContain('.select("id", { head: true, count: "exact" })');
    expect(repository).not.toContain("Supabase non pronto: applica la migration 006_property_worker_archives.sql prima di avviare il worker");
    expect(repository).toContain("Archivio dati non raggiungibile");
  });
});

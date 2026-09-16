import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WorkerRepository } from "../src/services/repository.js";

/**
 * Anche una run che si ferma prima della prima riga e' un fatto operativo:
 * il registro la conserva con zero elementi e con la causa del blocco.
 */
describe("acquisizioni interrotte senza nulla dentro", () => {
  it("conta immobili e persone della lavorazione senza scaricarne le righe", async () => {
    const richieste: Array<{ table: string; columns: string; options: unknown; jobId: string }> = [];
    const conteggi: Record<string, number> = {
      property_worker_properties: 7,
      property_worker_people: 12,
    };
    const client = {
      from: (table: string) => ({
        select: (columns: string, options: unknown) => ({
          eq: async (_column: string, jobId: string) => {
            richieste.push({ table, columns, options, jobId });
            return { error: null, count: conteggi[table], data: null };
          },
        }),
      }),
    };
    const repository = Object.create(WorkerRepository.prototype) as WorkerRepository;
    Object.defineProperty(repository, "client", { value: client });

    await expect(repository.countAcquisition("job-1")).resolves.toEqual({ properties: 7, people: 12 });
    expect(richieste.map((richiesta) => richiesta.table)).toEqual([
      "property_worker_properties",
      "property_worker_people",
    ]);
    /* `head` vuol dire che il database conta e non spedisce niente. */
    expect(richieste.every((richiesta) => richiesta.columns === "id")).toBe(true);
    expect(richieste.every(({ options }) => (options as { head?: boolean }).head === true)).toBe(true);
  });

  it("restituisce zero quando il database non sa dare un conteggio", async () => {
    const client = {
      from: () => ({
        select: () => ({ eq: async () => ({ error: null, count: null, data: null }) }),
      }),
    };
    const repository = Object.create(WorkerRepository.prototype) as WorkerRepository;
    Object.defineProperty(repository, "client", { value: client });

    await expect(repository.countAcquisition("job-1")).resolves.toEqual({ properties: 0, people: 0 });
  });

  it("conserva anche la lavorazione vuota e aggiorna i totali reali", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

    expect(main).toContain("async function chiudiAcquisizioneInterrotta(jobId: string | null, motivo: string)");
    expect(main).toMatch(/if \(!totali\.properties\) \{\s*await repo\.updateJob\(jobId,/);
    expect(main).toContain("Acquisizione interrotta prima della prima riga");
    /* Con qualcosa dentro la riga resta, ma con i totali veri: durante la run
     * non vengono aggiornati, e mostrerebbe zero immobili pur avendone. */
    expect(main).toMatch(/total_properties: totali\.properties,\s*total_people: totali\.people,\s*status: "paused",/);
  });

  it("ripulisce sia la run via sia la run rete quando falliscono", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

    expect(main).toContain("await chiudiAcquisizioneInterrotta(streetImportJobId, streetRunError);");
    expect(main).toContain("await chiudiAcquisizioneInterrotta(networkImportJobId, networkRunError);");
    /* Anche fermare la run a mano lasciava la stessa riga vuota. */
    expect(main).toContain(`await chiudiAcquisizioneInterrotta(streetImportJobId, "Run via interrotta dall'operatore.");`);
    expect(main).toContain("let networkImportJobId: string | null = null;");
  });

  it("crea il record della via prima di collegarsi a Chrome", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const street = main.slice(main.indexOf("async function runSisterStreet("), main.indexOf("async function runPortoni("));
    const record = street.indexOf('createJob("automatic")');
    const browser = street.indexOf("connectToChrome(config.CHROME_CDP_URL");
    expect(record).toBeGreaterThan(-1);
    expect(browser).toBeGreaterThan(record);
  });

  it("legge i semi della rete prima di aprire il browser e di creare la lavorazione", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

    /* `connectToChrome` compare anche nella run via: qui conta soltanto
     * l'ordine dentro la run rete. */
    const rete = main.slice(main.indexOf("async function runSisterNetwork("));
    const semi = rete.indexOf("seeds = await repository(config).listVerifiedNetworkSeedTaxCodes(settings.seedCount);");
    const browser = rete.indexOf("connectToChrome(config.CHROME_CDP_URL");
    const lavorazione = rete.indexOf('createJob("automatic")');
    expect(semi).toBeGreaterThan(-1);
    expect(browser).toBeGreaterThan(semi);
    expect(lavorazione).toBeGreaterThan(semi);
    expect(main).not.toContain("const seeds = await liveRepository.listVerifiedNetworkSeedTaxCodes");

    /* Se l'archivio non basta, i punti di partenza li sorteggia il gestionale,
     * e anche quello succede prima che nasca la lavorazione. */
    const sorteggio = rete.indexOf("collectCrmPersonSeeds(tabs.crmPage");
    expect(sorteggio).toBeGreaterThan(-1);
    expect(lavorazione).toBeGreaterThan(sorteggio);
    expect(rete).toContain("if (seeds.length < settings.seedCount) {");

    /* Il rifiuto resta, ma solo quando non c'e' proprio niente da nessuna
     * delle due parti. */
    const rifiuto = rete.indexOf("Non ho trovato nessun codice fiscale da cui partire");
    expect(rifiuto).toBeGreaterThan(sorteggio);
    expect(lavorazione).toBeGreaterThan(rifiuto);
  });
});

import { describe, expect, it, vi } from "vitest";
import { CloudIdentityMemory, hydrateCloudMemory } from "../src/territory/cloud-memory.js";
import { unitKey, type TerritoryState, type Street } from "../src/territory/model.js";
import { simulationSource } from "../src/territory/providers.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import type { TecnocloudV2Port } from "../src/import-v2/ports.js";
const street: Street = { id: "a", name: "Via Francesco Perrese", sisterName: "VIA FRANCESCO PERRESE", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const source = simulationSource(street, 1, "run"), plan = buildPlan(source), cf = source.owners[0]!.taxCode, key = unitKey(source);
const at = "2026-10-10T10:00:00Z";
const evidence = (ids: string[]) => ({ crmIds: ids, status: "found" as const, lastCheckedAt: at, lastVerifiedAt: at });
const property = { id: "cloud-property", displayName: "Immobile", fullAddress: source.fullAddress, cadastral: source.cadastral, owners: [] };
const person = { id: "cloud-person", taxCode: cf, fullName: source.owners[0]!.fullName, birthDate: null, birthPlace: null, birthProvince: null, phones: [], emails: [] };
function setup(known = true) {
  const state: TerritoryState = { version: 1, streets: [street], memories: {}, units: {}, runs: [], events: [], checkpoints: {}, virtualCrm: {}, virtualPeople: {}, cloudMemory: { properties: known ? { [key]: evidence([property.id]) } : {}, people: known ? { [cf]: evidence([person.id]) } : {} } };
  const base = { readProperty: vi.fn().mockResolvedValue(property), readPerson: vi.fn().mockResolvedValue(person), findPropertiesByCadastralIdentity: vi.fn().mockResolvedValue([property]), searchPeopleByExactTaxCode: vi.fn().mockResolvedValue([person]) };
  const memory = new CloudIdentityMemory(state), port = memory.port(base as unknown as TecnocloudV2Port);
  return { state, base, memory, port };
}
describe("Memoria verificata di immobili e proprietari Cloud", () => {
  it("confronta gli ID noti senza aprire i collegamenti e mantiene la rilettura completa per la verifica finale", async () => {
    const { state, base } = setup();
    const identity = vi.fn().mockResolvedValue(property);
    const port = new CloudIdentityMemory(state).port({ ...base, readPropertyIdentity: identity } as unknown as TecnocloudV2Port);
    expect(await port.findPropertiesByCadastralIdentity(plan)).toEqual([property]);
    expect(identity).toHaveBeenCalledExactlyOnceWith(property.id);
    expect(base.readProperty).not.toHaveBeenCalled();
    expect(base.findPropertiesByCadastralIdentity).not.toHaveBeenCalled();
    await port.readProperty(property.id);
    expect(base.readProperty).toHaveBeenCalledExactlyOnceWith(property.id);
  });

  it("una lettura di sola identita fallita non autorizza la creazione di una scheda nota", async () => {
    const { state, base } = setup();
    base.findPropertiesByCadastralIdentity.mockResolvedValue([]);
    const identity = vi.fn().mockRejectedValue(new ImportV2Error("Timeout caricamento", "transient_portal", { retryable: true }));
    const port = new CloudIdentityMemory(state).port({ ...base, readPropertyIdentity: identity } as unknown as TecnocloudV2Port);
    await expect(port.findPropertiesByCadastralIdentity(plan)).rejects.toThrow("nessuna creazione");
    expect(base.readProperty).not.toHaveBeenCalled();
    expect(base.findPropertiesByCadastralIdentity).toHaveBeenCalledOnce();
  });

  it("riapre direttamente gli ID noti, aggiorna la verifica e conserva gli ID dopo una nuova acquisizione", async () => {
    const { state, base, memory, port } = setup();
    expect(await port.findPropertiesByCadastralIdentity(plan)).toEqual([property]);
    expect(await port.searchPeopleByExactTaxCode(cf)).toEqual([person]);
    expect(base.readPerson).toHaveBeenCalledWith(person.id, cf);
    expect(base.findPropertiesByCadastralIdentity).not.toHaveBeenCalled();
    expect(base.searchPeopleByExactTaxCode).not.toHaveBeenCalled();
    memory.flush(state);
    expect(Date.parse(state.cloudMemory!.properties[key]!.lastVerifiedAt!)).toBeGreaterThan(Date.parse(at));
    const restored = new CloudIdentityMemory(structuredClone(state)).port(base as unknown as TecnocloudV2Port);
    const newer = structuredClone(plan); newer.source.sourcePropertyId = "new-observation";
    await restored.findPropertiesByCadastralIdentity(newer); await restored.searchPeopleByExactTaxCode(cf);
    expect(base.findPropertiesByCadastralIdentity).not.toHaveBeenCalled();
  });
  it("deduplica un proprietario per CF e lo riusa tra immobili differenti", async () => {
    const { state, port, memory, base } = setup(false);
    await port.searchPeopleByExactTaxCode(cf); await port.searchPeopleByExactTaxCode(cf); memory.flush(state);
    expect(base.searchPeopleByExactTaxCode).toHaveBeenCalledTimes(1);
    expect(base.readPerson).toHaveBeenCalledTimes(1);
    expect(Object.keys(state.cloudMemory!.people)).toEqual([cf]);
  });
  it("non conserva l'assenza come scorciatoia e non chiama creazioni dopo errori", async () => {
    const { state, port, base, memory } = setup(false);
    base.findPropertiesByCadastralIdentity.mockResolvedValue([]); base.searchPeopleByExactTaxCode.mockResolvedValue([]);
    await port.findPropertiesByCadastralIdentity(plan); await port.findPropertiesByCadastralIdentity(plan);
    await port.searchPeopleByExactTaxCode(cf); await port.searchPeopleByExactTaxCode(cf); memory.flush(state);
    expect(base.findPropertiesByCadastralIdentity).toHaveBeenCalledTimes(2);
    expect(base.searchPeopleByExactTaxCode).toHaveBeenCalledTimes(2);
    expect(state.cloudMemory!.properties[key]!.lastVerifiedAt).toBe(null);
    base.findPropertiesByCadastralIdentity.mockRejectedValue(new Error("Ricerca incompleta"));
    await expect(port.findPropertiesByCadastralIdentity(plan)).rejects.toThrow("incompleta");
  });
  it("una scheda cambiata obbliga una ricerca nuova e non usa il vecchio ID", async () => {
    const { base, memory, state, port } = setup();
    base.readProperty.mockResolvedValue({ ...property, cadastral: { ...source.cadastral, subaltern: "ALTRA" } });
    base.findPropertiesByCadastralIdentity.mockResolvedValue([]);
    base.readPerson.mockResolvedValue({ ...person, taxCode: "RSSMRA80A01A893P" });
    base.searchPeopleByExactTaxCode.mockResolvedValue([]);
    expect(await port.findPropertiesByCadastralIdentity(plan)).toEqual([]);
    expect(await port.searchPeopleByExactTaxCode(cf)).toEqual([]);
    memory.flush(state);
    expect(state.cloudMemory!.properties[key]).toMatchObject({ status: "not_found", crmIds: [property.id], lastVerifiedAt: at });
    expect(state.cloudMemory!.people[cf]).toMatchObject({ status: "not_found", lastVerifiedAt: at });
  });
  it("dopo un ID non leggibile prova la ricerca mirata, ma sessione e pausa fermano le scritture", async () => {
    const { base, port, memory, state } = setup();
    base.readProperty.mockRejectedValue(new ImportV2Error("Timeout caricamento", "transient_portal", { retryable: true }));
    expect(await port.findPropertiesByCadastralIdentity(plan)).toEqual([property]);
    expect(base.findPropertiesByCadastralIdentity).toHaveBeenCalledOnce();
    base.readPerson.mockRejectedValue(new ImportV2Error("Sessione scaduta", "global_session", { global: true }));
    await expect(port.searchPeopleByExactTaxCode(cf)).rejects.toThrow("scaduta");
    expect(base.searchPeopleByExactTaxCode).not.toHaveBeenCalled();
  });
  it("conserva tutte le corrispondenze ambigue, senza scegliere un duplicato silenziosamente", async () => {
    const { state, base } = setup();
    state.cloudMemory!.properties[key] = evidence(["p1", "p2"]);
    base.readProperty.mockImplementation(async (id: string) => ({ ...property, id }));
    const port = new CloudIdentityMemory(state).port(base as unknown as TecnocloudV2Port);
    expect((await port.findPropertiesByCadastralIdentity(plan)).map(p => p.id)).toEqual(["p1", "p2"]);
    expect(base.findPropertiesByCadastralIdentity).not.toHaveBeenCalled();
  });
  it("una scheda nota illeggibile non diventa assente se anche la ricerca mirata restituisce zero", async () => {
    const { base, port, memory, state } = setup();
    const timeout = new ImportV2Error("Timeout caricamento", "transient_portal", { retryable: true });
    base.readProperty.mockRejectedValue(timeout); base.findPropertiesByCadastralIdentity.mockResolvedValue([]);
    await expect(port.findPropertiesByCadastralIdentity(plan)).rejects.toThrow("nessuna creazione");
    await expect(port.findPropertiesByCadastralIdentity(plan)).rejects.toThrow("nessuna creazione");
    base.readPerson.mockRejectedValue(timeout); base.searchPeopleByExactTaxCode.mockResolvedValue([]);
    await expect(port.searchPeopleByExactTaxCode(cf)).rejects.toThrow("nessuna nuova anagrafica");
    memory.flush(state);
    const restarted = new CloudIdentityMemory(state).port(base as unknown as TecnocloudV2Port);
    await expect(restarted.findPropertiesByCadastralIdentity(plan)).rejects.toThrow("nessuna creazione");
    await expect(restarted.searchPeopleByExactTaxCode(cf)).rejects.toThrow("nessuna nuova anagrafica");
  });
  it("un subalterno vuoto non riconosce un altro sub e gli errori CF non diventano nuovi proprietari", async () => {
    const { port, base } = setup(false); const noSub = structuredClone(plan); noSub.source.cadastral.subaltern = "";
    await port.findPropertiesByCadastralIdentity(noSub);
    base.searchPeopleByExactTaxCode.mockResolvedValue([{ ...person, taxCode: "ALTRO" }]);
    await expect(port.searchPeopleByExactTaxCode(cf)).rejects.toThrow("non coerente");
  });
  it("recupera fatti storici verificati senza inventare date mancanti", () => {
    const { state } = setup(false);
    state.units[key] = { key, streetIds: [street.id], observations: [{ source, at, runId: "run", origin: "sister" }], corrections: {}, note: "", assessment: null, importedAt: at, crmId: property.id, journal: [{ id: "e", kind: "import_completed", at, recordedAt: at, runId: "run", origin: "live", crmId: property.id, message: "Verificato", syncedPeople: [{ sourcePersonId: "o", taxCode: cf, crmPersonId: person.id, mergePerformed: false }] }] };
    hydrateCloudMemory(state); expect(state.cloudMemory!.properties[key]!.lastVerifiedAt).toBe(at);
    expect(state.cloudMemory!.people[cf]!.crmIds).toEqual([person.id]);
    const once = structuredClone(state.cloudMemory); hydrateCloudMemory(state); expect(state.cloudMemory).toEqual(once);
  });
});

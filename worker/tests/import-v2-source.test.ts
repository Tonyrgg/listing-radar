import { describe, expect, it } from "vitest";

import { importV2Sources } from "../src/import-v2/source.js";
import { inspectAcquisitionQueue } from "../src/services/acquisition-queue.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { ImportV2Engine } from "../src/import-v2/engine.js";
import type { TecnocloudV2Port } from "../src/import-v2/ports.js";
import { WorkflowMemoryStore } from "./helpers/import-v2-workflow-fixture.js";
import type { PersonRow, PropertyRow } from "../src/services/repository.js";

const property: PropertyRow = {
  id: "property-id", job_id: "job-id", municipality: "BITONTO", sheet: "49", parcel: "1243", subaltern: "34",
  cadastral_key: "BITONTO|49|1243|34", address: "Arco Angarano 10, 70032 BITONTO (BA)", census_zone: null,
  category: "A/2", class: "3", consistency: "6 vani", cadastral_income: 356.36,
  raw_payload: { rawCells: { sezioneUrbana: "U", denomParticella: "LOTTO A" } }, processing_status: "normalized", crm_record_id: null,
};

const person: PersonRow = {
  id: "person-id", job_id: "job-id", full_name: "Rossi Mario", birth_place: "Bitonto", birth_province: "BA",
  birth_date: "1980-01-01", tax_code: "RSSMRA80A01A893P", right_type: "Dato persona non autorevole", share_original: "1/2",
  share_numerator: 1, share_denominator: 2, share_percentage: 50, mobiles: ["3331111111"], landlines: ["0801111111"],
  emails: ["mario@example.it"], raw_payload: null, processing_status: "normalized", crm_record_id: null,
};

describe("Import V2 acquisition bridge", () => {
  it.each(["acquisition_skipped", "acquisition_failed", "skipped"])("rispetta lo stato %s anche senza metadati nel payload", status => {
    expect(importV2Sources({ id: "job-id" }, {
      properties: [{ ...property, processing_status: status, raw_payload: null }],
      people: [person], ownerships: [],
    }, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }))).toEqual([]);
  });

  const activity = () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" } as const);
  const acquired = () => ({ properties: [structuredClone(property)], people: [structuredClone(person)],
    ownerships: [{ id: "link", property_id: property.id, person_id: person.id, share_percentage: 50 as number | null, right_type: "Proprietà" }] });

  it("valida le quote di ciascun immobile anche quando il nominativo è condiviso e la sua quota globale manca", () => {
    const graph = acquired();
    graph.people[0]!.share_percentage = null;
    graph.properties.push({ ...property, id: "second-property", parcel: "99" });
    graph.ownerships.push({ ...graph.ownerships[0]!, id: "second-link", property_id: "second-property", share_percentage: 25 });
    expect(inspectAcquisitionQueue(graph).invalidProperties.size).toBe(0);
    expect(importV2Sources({ id: "job-id" }, graph, activity).map(source => buildPlan(source).source.owners[0]!.sharePercentage)).toEqual([50, 25]);
  });

  it.each([null, 0, -1, 101, NaN, Infinity])("non usa la quota globale per nascondere una quota del collegamento non valida (%s)", share => {
    const graph = acquired();
    graph.ownerships[0]!.share_percentage = share;
    const queue = inspectAcquisitionQueue(graph);
    expect(queue.invalidProperties.has(property.id)).toBe(true);
    expect(queue.invalidOwnerships.map(link => link.id)).toEqual(["link"]);
    expect(() => buildPlan(importV2Sources({ id: "job-id" }, graph, activity)[0]!)).toThrow(/Quota/);
  });

  it("accantona tutto l'immobile prima di qualsiasi accesso CRM se manca anche un solo comproprietario", async () => {
    const graph = acquired();
    graph.ownerships.push({ ...graph.ownerships[0]!, id: "orphan", person_id: "missing-person" });
    const store = new WorkflowMemoryStore();
    const crm = new Proxy({} as TecnocloudV2Port, { get() { throw new Error("Il CRM non deve essere consultato con una coda incompleta"); } });
    const [source] = importV2Sources({ id: "job-id" }, graph, activity);
    expect(inspectAcquisitionQueue(graph).missingPersonIds).toEqual(["missing-person"]);
    expect(await new ImportV2Engine(crm, store).run(source!)).toMatchObject({ state: "quarantined", stage: "queued", failure: { kind: "invalid_source" } });
    expect(store.checkpoints.size).toBe(0);
  });

  it("segnala catasto vuoto, nominativo incompleto e collegamenti tra job diversi", () => {
    const graph = acquired();
    graph.properties[0]!.subaltern = "  ";
    expect(inspectAcquisitionQueue(graph).incompleteProperties).toHaveLength(1);
    graph.properties[0]!.subaltern = "34";
    graph.people[0]!.tax_code = null;
    expect(inspectAcquisitionQueue(graph).incompletePeople).toHaveLength(1);
    graph.people[0]!.tax_code = person.tax_code;
    graph.people[0]!.job_id = "other-job";
    expect([...inspectAcquisitionQueue(graph).invalidProperties.values()]).toEqual(["Nominativo collegato appartenente a un'altra acquisizione"]);
  });

  it("prepara la coda senza modificare i dati acquisiti o aggiungere metadati ai piani validi", () => {
    const graph = acquired();
    const original = structuredClone(graph);
    const [source] = importV2Sources({ id: "job-id" }, graph, activity);
    expect(source).not.toHaveProperty("acquisitionError");
    buildPlan(source!);
    expect(graph).toEqual(original);
  });
  it("usa il diritto e la quota specifici del collegamento, non quelli globali della persona", () => {
    const [source] = importV2Sources({ id: "job-id" }, {
      properties: [property],
      people: [person],
      ownerships: [{
        id: "ownership-id", property_id: "property-id", person_id: "person-id",
        share_percentage: 50, right_type: "Nuda proprietà",
      }],
    }, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" }));

    expect(source).toMatchObject({
      cadastral: { urbanSection: "U", parcelDenomination: "LOTTO A", sheet: "49", parcel: "1243", subaltern: "34", income: 356.36 },
      owners: [{ rightType: "Nuda proprietà", sharePercentage: 50, contacts: { phones: ["3331111111", "0801111111"] } }],
    });
  });

  it("porta alla V2 l'evidenza di un soggetto aziendale scartato a monte", () => {
    const markedProperty = {
      ...property,
      raw_payload: { ...property.raw_payload, acquisition: { status: "owners_acquired", businessSubjectsPresent: true } },
    };
    const [source] = importV2Sources({ id: "job-id" }, {
      properties: [markedProperty], people: [person],
      ownerships: [{ id: "ownership-id", property_id: "property-id", person_id: "person-id", share_percentage: 50, right_type: "Proprietà" }],
    }, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" }));

    expect(source?.hasBusinessOwners).toBe(true);
  });

  it("riconosce anche l'evidenza storica delle acquisizioni precedenti", () => {
    const [source] = importV2Sources({ id: "job-id" }, {
      properties: [{ ...property, raw_payload: { ...property.raw_payload, sourceOrder: 7 } }],
      people: [person],
      ownerships: [{ id: "ownership-id", property_id: "property-id", person_id: "person-id", share_percentage: 50, right_type: "Proprietà" }],
    }, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" }), {
      businessOwnerRowIndexes: new Set([7]),
    });

    expect(source?.hasBusinessOwners).toBe(true);
  });

  it("non rimette in coda righe già escluse durante l'acquisizione", () => {
    const sources = importV2Sources({ id: "job-id" }, {
      properties: [{ ...property, raw_payload: { acquisition: { status: "acquisition_skipped" } } }],
      people: [person],
      ownerships: [{ id: "ownership-id", property_id: "property-id", person_id: "person-id", share_percentage: 50, right_type: "Proprietà" }],
    }, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" }));

    expect(sources).toEqual([]);
  });
});

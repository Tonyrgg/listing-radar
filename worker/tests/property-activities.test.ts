import { describe, expect, it } from "vitest";

import {
  buildPropertyActivityTasks,
  directContactOrdinalForTask,
  isDirectContactNrOrdinal,
  propertyActivityDefinition,
  readPropertyActivityCheckpoint,
} from "../src/services/property-activities.js";
import type { PersonRow, PropertyRow } from "../src/services/repository.js";

const property = (overrides: Partial<PropertyRow> = {}): PropertyRow => ({
  id: "property-1",
  job_id: "job-1",
  municipality: "BITONTO",
  sheet: "50",
  parcel: "1391",
  subaltern: "27",
  cadastral_key: "BITONTO|50|1391|27",
  address: "Via Borgo San Francesco 29 [2]",
  census_zone: null,
  category: "A/3",
  class: null,
  consistency: null,
  cadastral_income: null,
  raw_payload: {},
  processing_status: "dry_run",
  crm_record_id: "crm-property-1",
  ...overrides,
});

const person = (id: string, crmId: string, name: string): PersonRow => ({
  id,
  job_id: "job-1",
  full_name: name,
  birth_place: null,
  birth_province: null,
  birth_date: null,
  tax_code: null,
  right_type: "Proprietà",
  share_original: "1/1",
  share_numerator: 1,
  share_denominator: 1,
  share_percentage: 100,
  mobiles: [],
  landlines: [],
  emails: [],
  raw_payload: {},
  processing_status: "dry_run",
  crm_record_id: crmId,
});

describe("attività property-centric", () => {
  it("crea un solo task per immobile anche con più comproprietari", () => {
    const people = [person("person-1", "crm-person-1", "Primo"), person("person-2", "crm-person-2", "Secondo"), person("person-3", "crm-person-3", "Terzo")];
    const tasks = buildPropertyActivityTasks({
      properties: [property()],
      people,
      ownerships: [
        { property_id: "property-1", person_id: "person-1", share_percentage: 20 },
        { property_id: "property-1", person_id: "person-2", share_percentage: 60 },
        { property_id: "property-1", person_id: "person-3", share_percentage: 20 },
      ],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.owners).toHaveLength(3);
    expect(tasks[0]?.fallbackPersonId).toBe("crm-person-2");
  });

  it("converte i vecchi marker per proprietario in un solo checkpoint dry-run", () => {
    const checkpoint = readPropertyActivityCheckpoint({
      worker_activities: {
        "person-1": { crmActivityId: "dry-activity-crm-property-1", dryRun: true },
        "person-2": { crmActivityId: "dry-activity-crm-property-1", dryRun: true },
      },
    }, true, "crm-property-1");
    expect(checkpoint).toMatchObject({ source: "legacy-person-flow", state: "simulated", dryRun: true, crmPropertyId: "crm-property-1" });
  });

  it("non riusa un checkpoint dry-run durante un futuro run reale", () => {
    const checkpoint = readPropertyActivityCheckpoint({
      worker_activity: {
        version: 2,
        source: "property",
        state: "simulated",
        dryRun: true,
      },
    }, false, "crm-property-1");
    expect(checkpoint).toBeNull();
  });

  it("mantiene Telefonata e Da eseguire se almeno un proprietario ha un recapito", () => {
    const owner = person("person-1", "crm-person-1", "Primo");
    owner.mobiles = ["3331112222"];
    expect(propertyActivityDefinition([owner], 1)).toEqual({
      contactMode: "Telefonata",
      status: "Da eseguire",
      description: "Inserire attività",
      directContactOrdinal: null,
    });
  });

  it("usa Contatto diretto, Eseguito e rotazione soltanto quando nessun proprietario ha telefoni", () => {
    const owners = [person("person-1", "crm-person-1", "Primo"), person("person-2", "crm-person-2", "Secondo")];
    expect(propertyActivityDefinition(owners, 1)).toMatchObject({
      contactMode: "Contatto diretto",
      status: "Eseguito",
      description: "Non sa nulla",
      directContactOrdinal: 1,
    });
    expect(propertyActivityDefinition(owners, 7).description).toBe("nr");
    expect(propertyActivityDefinition(owners, 16).description).toBe("nr");
    expect(isDirectContactNrOrdinal(8)).toBe(false);
  });

  it("lascia generica l'attività senza recapiti quando l'autocompilazione è disattivata", () => {
    const owner = person("person-1", "crm-person-1", "Primo");
    expect(propertyActivityDefinition([owner], 1, false)).toEqual({
      contactMode: "Telefonata",
      status: "Da eseguire",
      description: "Inserire attività",
      directContactOrdinal: null,
    });
  });

  it("incrementa la sequenza soltanto per contatti diretti realmente completati", () => {
    const people = [person("person-1", "crm-person-1", "Primo"), person("person-2", "crm-person-2", "Secondo")];
    const first = property({
      id: "property-1",
      raw_payload: { worker_activity: { state: "skipped", contactMode: "Contatto diretto" } },
    });
    const second = property({ id: "property-2", cadastral_key: "BITONTO|50|1391|28" });
    let tasks = buildPropertyActivityTasks({
      properties: [first, second],
      people,
      ownerships: [
        { property_id: "property-1", person_id: "person-1", share_percentage: 100 },
        { property_id: "property-2", person_id: "person-2", share_percentage: 100 },
      ],
    });
    expect(directContactOrdinalForTask(tasks, "property-2")).toBe(1);

    first.raw_payload = { worker_activity: { state: "created", contactMode: "Contatto diretto" } };
    tasks = buildPropertyActivityTasks({
      properties: [first, second],
      people,
      ownerships: [
        { property_id: "property-1", person_id: "person-1", share_percentage: 100 },
        { property_id: "property-2", person_id: "person-2", share_percentage: 100 },
      ],
    });
    expect(directContactOrdinalForTask(tasks, "property-2")).toBe(2);
  });
});

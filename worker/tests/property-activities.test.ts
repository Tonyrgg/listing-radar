import { describe, expect, it } from "vitest";

import {
  buildPropertyActivityTasks,
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
});

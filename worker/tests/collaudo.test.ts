import { describe, expect, it } from "vitest";

import {
  COLLAUDO_MAX_PROPERTIES,
  COLLAUDO_STREET,
  assertCollaudoStreet,
  evaluateCollaudo,
  isCollaudoStreet,
} from "../src/services/collaudo.js";
import type { JobRow, PersonRow, PropertyRow } from "../src/services/repository.js";

const property = (id: string, address = "VIA PIETRO COLLETTA n. 4"): PropertyRow => ({
  id, job_id: "job", municipality: "BITONTO", sheet: "1", parcel: id, subaltern: "1",
  cadastral_key: `BITONTO|1|${id}|1`, address, census_zone: null, category: "A/3", class: null,
  consistency: null, cadastral_income: null, raw_payload: {}, processing_status: "synced", crm_record_id: `crm-${id}`,
});

const person = (id: string, phones: string[] = []): PersonRow => ({
  id, job_id: "job", full_name: `Persona ${id}`, birth_place: null, birth_province: null, birth_date: null,
  tax_code: `RSSMRA80A01A${id.padStart(3, "0")}X`, right_type: "Proprietà", share_original: "1/1",
  share_numerator: 1, share_denominator: 1, share_percentage: 100, mobiles: phones, landlines: [], emails: [],
  raw_payload: {}, processing_status: "synced", crm_record_id: `crm-person-${id}`,
});

describe("collaudatore production guard", () => {
  it("accetta soltanto l'indirizzo esatto della via autorizzata", () => {
    expect(isCollaudoStreet("Via Pietro Colletta, 7 - Bitonto")).toBe(true);
    expect(isCollaudoStreet("Via Pietro Colletta Nuova, 7 - Bitonto")).toBe(false);
    expect(isCollaudoStreet("Via Pietro Micca, 7 - Bitonto")).toBe(false);
    expect(() => assertCollaudoStreet("Via Luigi Castellucci")).toThrow(/Perimetro di collaudo violato/);
  });

  it("rileva opzioni killer ignorate, sconfinamenti e comproprietari mancanti", () => {
    const properties = [property("1"), property("2", "VIA LUIGI CASTELLUCCI n. 2")];
    const people = [person("1", ["3331234567"]), person("2")];
    const assertions = evaluateCollaudo({
      job: {
        id: "job", mode: "automatic", status: "paused", current_step: "properties_processed", last_completed_step: "acquisition_reviewed",
        municipality: "BITONTO", street: COLLAUDO_STREET, civic_number: null, sister_source_url: null,
        acquisition: { importOptions: { activityMode: "plain", importCoOwners: false, parallelCrmWindows: false } },
      },
      graph: { properties, people, ownerships: [
        { id: "o1", property_id: "1", person_id: "1", share_percentage: 50 },
        { id: "o2", property_id: "1", person_id: "2", share_percentage: 50 },
      ] },
      items: [{
        id: "item", property_id: "1", stage: "completed", status: "completed", last_error: null,
        checkpoint: { crmPropertyId: "crm-1", syncedPeople: [{ sourcePersonId: "1", taxCode: "X", crmPersonId: "P1", mergePerformed: false }] },
        plan: {
          version: 2, fingerprint: "f", source: {
            sourcePropertyId: "1", jobId: "job", municipality: "BITONTO", fullAddress: "VIA PIETRO COLLETTA n. 4",
            cadastral: { urbanSection: null, sheet: "1", parcel: "1", parcelDenomination: null, subaltern: "1", income: null },
            category: "A/3", propertyClass: null, consistency: null,
            activity: { enabled: true, description: "Inserire attività", contactMode: "Telefonata", status: "Da eseguire" }, owners: [],
          },
        },
      }],
      minimumCompleted: 1,
      expectedPaused: true,
    });
    expect(assertions.filter((assertion) => assertion.status === "failed").map((assertion) => assertion.id)).toEqual(expect.arrayContaining([
      "street_boundary", "run_options", "owners_1", "killer_1",
    ]));
  });

  it("approva un checkpoint killer coerente entro il budget", () => {
    const properties = [property("1")];
    properties[0]!.raw_payload = {
      worker_activity: {
        version: 3, source: "property", state: "created", dryRun: false,
        description: "Non vende", contactMode: "Telefonata", status: "Eseguito",
        crmPropertyId: "crm-1", crmActivityId: null, correlatedProperty: null,
        attempts: 1, error: null, updatedAt: "2026-09-13T10:00:00.000Z",
      },
    };
    const people = [person("1", ["3331234567"]), person("2")];
    const assertions = evaluateCollaudo({
      job: {
        id: "job", mode: "automatic", status: "completed", current_step: "completed", last_completed_step: "completed",
        municipality: "BITONTO", street: COLLAUDO_STREET, civic_number: null, sister_source_url: null,
        acquisition: { importOptions: { activityMode: "killer", importCoOwners: true, parallelCrmWindows: false } },
      },
      graph: { properties, people, ownerships: [
        { id: "o1", property_id: "1", person_id: "1", share_percentage: 50 },
        { id: "o2", property_id: "1", person_id: "2", share_percentage: 50 },
      ] },
      items: [{
        id: "item", property_id: "1", stage: "completed", status: "completed", last_error: null,
        checkpoint: { crmPropertyId: "crm-1", syncedPeople: [
          { sourcePersonId: "1", taxCode: "X", crmPersonId: "P1", mergePerformed: false },
          { sourcePersonId: "2", taxCode: "Y", crmPersonId: "P2", mergePerformed: false },
        ] },
        plan: {
          version: 2, fingerprint: "f", source: {
            sourcePropertyId: "1", jobId: "job", municipality: "BITONTO", fullAddress: "VIA PIETRO COLLETTA n. 4",
            cadastral: { urbanSection: null, sheet: "1", parcel: "1", parcelDenomination: null, subaltern: "1", income: null },
            category: "A/3", propertyClass: null, consistency: null,
            activity: { enabled: true, description: "Non vende", contactMode: "Telefonata", status: "Eseguito" }, owners: [],
          },
        },
      }],
      minimumCompleted: 1,
      expectedPaused: false,
    });
    expect(properties).toHaveLength(1);
    expect(properties.length).toBeLessThanOrEqual(COLLAUDO_MAX_PROPERTIES);
    expect(assertions.every((assertion) => assertion.status === "passed")).toBe(true);
  });
});

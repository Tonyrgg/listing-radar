import { describe, expect, it } from "vitest";

import { buildPropertyWorkPlan, PROPERTY_WORK_SEQUENCE } from "../src/services/property-workflow.js";
import type { PersonRow, PropertyRow } from "../src/services/repository.js";

const property = (id: string): PropertyRow => ({
  id, job_id: "job", municipality: "BITONTO", sheet: "1", parcel: id, subaltern: "1",
  cadastral_key: `BITONTO|1|${id}|1`, address: `Via ${id}`, census_zone: null,
  category: "A/3", class: null, consistency: null, cadastral_income: null,
  raw_payload: {}, processing_status: "normalized", crm_record_id: null,
});

const person = (id: string): PersonRow => ({
  id, job_id: "job", full_name: id, birth_place: null, birth_province: null, birth_date: null,
  tax_code: `TAX${id}`, right_type: "Proprietà", share_original: "1/2", share_numerator: 1,
  share_denominator: 2, share_percentage: 50, mobiles: [], landlines: [], emails: [],
  raw_payload: {}, processing_status: "normalized", crm_record_id: null,
});

describe("piano di lavorazione per immobile", () => {
  it("lavora gli immobili nell'ordine acquisito e sceglie come principale la quota maggiore", () => {
    const properties = [property("p1"), property("p2")];
    const people = [person("owner-a"), person("owner-b"), person("owner-c")];
    const ownerships = [
      { id: "o1", property_id: "p1", person_id: "owner-a", share_percentage: 30, processing_status: "extracted", crm_link_id: null },
      { id: "o2", property_id: "p1", person_id: "owner-b", share_percentage: 70, processing_status: "extracted", crm_link_id: null },
      { id: "o3", property_id: "p2", person_id: "owner-c", share_percentage: 100, processing_status: "extracted", crm_link_id: null },
    ];
    const plan = buildPropertyWorkPlan({ properties, people, ownerships });
    expect(plan.map((item) => item.property.id)).toEqual(["p1", "p2"]);
    expect(plan[0]?.primary.person.id).toBe("owner-b");
    expect(plan[0]?.coowners.map((owner) => owner.person.id)).toEqual(["owner-a"]);
  });

  it("mantiene la sequenza richiesta per ciascun immobile", () => {
    expect(PROPERTY_WORK_SEQUENCE).toEqual([
      "primary_contacts", "primary_person", "property", "property_activity", "coowners", "ownership_shares",
    ]);
  });
});

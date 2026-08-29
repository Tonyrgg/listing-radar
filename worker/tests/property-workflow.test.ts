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
      "all_owner_contacts", "all_owners", "property", "property_activity", "primary_ownership", "correlated_owners_linked",
    ]);
  });

  it("a quote pari conserva l'ordine acquisito senza applicare preferenze anagrafiche", () => {
    const properties = [property("p1")];
    const people = [person("owner-z"), person("owner-a")];
    const ownerships = [
      { id: "o-z", property_id: "p1", person_id: "owner-z", share_percentage: 50, processing_status: "extracted", crm_link_id: null },
      { id: "o-a", property_id: "p1", person_id: "owner-a", share_percentage: 50, processing_status: "extracted", crm_link_id: null },
    ];
    expect(buildPropertyWorkPlan({ properties, people, ownerships })[0]?.primary.person.id).toBe("owner-z");
  });

  it("non rimette in coda gli immobili completati o saltati", () => {
    const completed = { ...property("done"), processing_status: "completed" };
    const skipped = { ...property("skip"), processing_status: "skipped" };
    const pending = property("next");
    const owners = [person("owner")];
    const ownerships = [completed, skipped, pending].map((item, index) => ({
      id: `o${index}`, property_id: item.id, person_id: "owner",
      share_percentage: 100, processing_status: "extracted", crm_link_id: null,
    }));
    expect(buildPropertyWorkPlan({ properties: [completed, skipped, pending], people: owners, ownerships })
      .map((item) => item.property.id)).toEqual(["next"]);
  });

  it("non pianifica due collegamenti per lo stesso comproprietario CRM", () => {
    const properties = [property("p1")];
    const duplicateOwner = { ...person("owner-duplicate"), crm_record_id: "CRM-OWNER-1" };
    const primary = { ...person("owner-primary"), crm_record_id: "CRM-OWNER-2", share_percentage: 60 };
    const ownerships = [
      { id: "o-primary", property_id: "p1", person_id: primary.id, share_percentage: 60, processing_status: "extracted", crm_link_id: null },
      { id: "o-duplicate-1", property_id: "p1", person_id: duplicateOwner.id, share_percentage: 20, processing_status: "extracted", crm_link_id: null },
      { id: "o-duplicate-2", property_id: "p1", person_id: duplicateOwner.id, share_percentage: 20, processing_status: "extracted", crm_link_id: null },
    ];
    const plan = buildPropertyWorkPlan({ properties, people: [primary, duplicateOwner], ownerships });
    expect(plan[0]?.owners).toHaveLength(2);
    expect(plan[0]?.coowners.map((owner) => owner.person.crm_record_id)).toEqual(["CRM-OWNER-1"]);
  });

  it("costruisce una long run di migliaia di immobili senza scansioni quadratiche", () => {
    const total = 4_000;
    const properties = Array.from({ length: total }, (_, index) => property(`p-${index}`));
    const people = Array.from({ length: total }, (_, index) => person(`owner-${index}`));
    const ownerships = properties.map((item, index) => ({
      id: `ownership-${index}`,
      property_id: item.id,
      person_id: people[index]!.id,
      share_percentage: 100,
      processing_status: "extracted",
      crm_link_id: null,
    }));
    const startedAt = performance.now();
    const plan = buildPropertyWorkPlan({ properties, people, ownerships });
    const elapsedMs = performance.now() - startedAt;
    expect(plan).toHaveLength(total);
    expect(plan[3_999]?.primary.person.id).toBe("owner-3999");
    expect(elapsedMs).toBeLessThan(1_500);
  });
});

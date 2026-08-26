import { describe, expect, it } from "vitest";

import {
  automaticRetryAttempts,
  buildAutomaticSkipImpact,
  canAutomaticallyRecoverPropertyFailure,
  nextAutomaticRetryAttempt,
} from "../src/core/automatic-skip.js";
import type { PersonRow, PropertyRow } from "../src/services/repository.js";

const property = (id: string, status = "normalized") => ({
  id,
  processing_status: status,
  raw_payload: {},
}) as PropertyRow;

const person = (id: string) => ({ id, raw_payload: {}, processing_status: "normalized" }) as PersonRow;

describe("skip automatico dopo i tentativi", () => {
  it("conta fino a tre tentativi persistiti nel payload", () => {
    expect(automaticRetryAttempts({ automatic_retry: { attempts: 2 } })).toBe(2);
    expect(nextAutomaticRetryAttempt({ automatic_retry: { attempts: 2 } })).toBe(3);
    expect(nextAutomaticRetryAttempt({ automatic_retry: { attempts: 3 } })).toBe(3);
  });

  it("recupera e poi salta anche errori di dati o revisione legati a un immobile", () => {
    expect(canAutomaticallyRecoverPropertyFailure("needs_review", { propertyId: "property-1" })).toBe(true);
    expect(canAutomaticallyRecoverPropertyFailure("data_incomplete", { propertyId: "property-1" })).toBe(true);
    expect(canAutomaticallyRecoverPropertyFailure("portal_error", { propertyId: "property-1" })).toBe(true);
  });

  it("non aggira mai pause, login richiesto o un salvataggio dall'esito incerto", () => {
    expect(canAutomaticallyRecoverPropertyFailure("paused", { propertyId: "property-1", pauseRequested: true })).toBe(false);
    expect(canAutomaticallyRecoverPropertyFailure("session_expired", { propertyId: "property-1" })).toBe(false);
    expect(canAutomaticallyRecoverPropertyFailure("needs_review", { propertyId: "property-1", action: "property-activity-save-uncertain" })).toBe(false);
  });

  it("salta il nominativo esclusivo ma conserva quello collegato a un altro immobile", () => {
    const impact = buildAutomaticSkipImpact({
      properties: [property("property-1"), property("property-2")],
      people: [person("person-only"), person("person-shared")],
      ownerships: [
        { id: "owner-1", property_id: "property-1", person_id: "person-only" },
        { id: "owner-2", property_id: "property-1", person_id: "person-shared" },
        { id: "owner-3", property_id: "property-2", person_id: "person-shared" },
      ],
    }, "property-1");

    expect(impact.personIds).toEqual(["person-only", "person-shared"]);
    expect(impact.exclusivePersonIds).toEqual(["person-only"]);
    expect(impact.ownershipIds).toEqual(["owner-1", "owner-2"]);
  });
});

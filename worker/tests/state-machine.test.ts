import { describe, expect, it } from "vitest";

import { canTransition, nextStep, WorkflowStateMachine } from "../src/core/state-machine.js";

describe("macchina a stati", () => {
  it("riprende dallo step successivo all'ultimo completato", () => {
    const state = WorkflowStateMachine.resume("person_created_or_updated");
    expect(state.current).toBe("person_merge_reviewed");
    expect(state.lastCompleted).toBe("person_created_or_updated");
  });
  it("avanza solo in ordine", () => {
    expect(canTransition("owners_extracted", "data_normalized")).toBe(true);
    expect(canTransition("owners_extracted", "person_searched")).toBe(false);
    expect(nextStep("completed")).toBe("completed");
  });
  it("segue il flusso nominativo, immobile, attività, recapiti e comproprietari", () => {
    expect(nextStep("data_normalized")).toBe("acquisition_reviewed");
    expect(nextStep("person_created_or_updated")).toBe("person_merge_reviewed");
    expect(nextStep("person_merge_reviewed")).toBe("property_searched");
    expect(nextStep("property_created_or_updated")).toBe("activity_created");
    expect(nextStep("activity_created")).toBe("contacts_matched");
    expect(nextStep("contacts_matched")).toBe("owners_linked");
  });
});

import { describe, expect, it } from "vitest";

import { canTransition, nextStep, WorkflowStateMachine } from "../src/core/state-machine.js";

describe("macchina a stati", () => {
  it("riprende il vecchio flusso dal ciclo completo per immobile", () => {
    const state = WorkflowStateMachine.resume("person_created_or_updated");
    expect(state.current).toBe("properties_processed");
    expect(state.lastCompleted).toBe("person_created_or_updated");
  });

  it("avanza solo in ordine", () => {
    expect(canTransition("owners_extracted", "data_normalized")).toBe(true);
    expect(canTransition("owners_extracted", "properties_processed")).toBe(false);
    expect(nextStep("completed")).toBe("completed");
  });

  it("dopo la raccolta esegue un unico ciclo persistente per ogni immobile", () => {
    expect(nextStep("data_normalized")).toBe("acquisition_reviewed");
    expect(nextStep("acquisition_reviewed")).toBe("properties_processed");
    expect(nextStep("properties_processed")).toBe("verified");
    expect(nextStep("verified")).toBe("completed");
  });

  it("riallinea ogni fase legacy al ciclo per immobile", () => {
    expect(nextStep("person_merge_reviewed")).toBe("properties_processed");
    expect(nextStep("activity_created")).toBe("properties_processed");
    expect(nextStep("owners_linked")).toBe("properties_processed");
  });
});

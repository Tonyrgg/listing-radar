import { describe, expect, it } from "vitest";
import { cloudActivityEvidence } from "../src/import-v2/activity-evidence.js";
const propertyId = "a01000000000001AAA";
const task = { Id: "00T000000000001AAA", WhatId: propertyId, Description: "Non vende", Status: "Eseguito" };
const evidence = (value: unknown) => cloudActivityEvidence(JSON.stringify(value), propertyId, "Non vende", "Eseguito");
describe("Attività Cloud correlata e verificata", () => {
  it("legge record Apex anche dentro returnValue serializzato", () => {
    expect(evidence({ actions: [{ returnValue: JSON.stringify({ records: [task] }) }] })).toMatchObject({ found: true, unresolved: false, activityId: task.Id, knownIds: [task.Id.slice(0, 15)] });
  });
  it("legge campi UI API, stato API e riferimenti equivalenti da 15 caratteri", () => {
    expect(evidence({ id: task.Id, apiName: "Task", fields: { WhatId: { value: propertyId.slice(0, 15) }, Description: { value: "Non vende" }, Status: { value: "Completed", displayValue: "Eseguito" } } }).found).toBe(true);
  });
  it("riconosce il prefisso Aura senza usare ricerche testuali nei metadati", () => {
    expect(cloudActivityEvidence(`while(1);${JSON.stringify(task)}`, propertyId, "Non vende", "Eseguito").found).toBe(true);
    expect(evidence({ picklistValues: ["Non vende", "Eseguito"] }).found).toBe(false);
  });
  it("non abbina record di un altro immobile o attività senza ID persistito", () => {
    expect(evidence({ ...task, WhatId: "a01000000000002AAA" }).found).toBe(false);
    expect(evidence({ ...task, Id: "" }).found).toBe(false);
  });
  it("non mescola descrizione e stato di due record o due risposte", () => {
    expect(evidence([{ ...task, Status: "Da eseguire" }, { ...task, Id: "00T000000000002AAA", Description: "Ci abita" }]).found).toBe(false);
    expect(evidence({ ...task, Description: "Non vende più" }).found).toBe(false);
  });
  it("conserva l'incertezza di un vero Task senza relazione o stato", () => {
    expect(evidence({ ...task, WhatId: undefined })).toMatchObject({ found: false, unresolved: true });
    expect(evidence({ ...task, WhatId: null })).toMatchObject({ found: false, unresolved: false });
    expect(evidence({ ...task, Status: null })).toMatchObject({ found: false, unresolved: true });
  });
  it("ignora HTML e JSON malformato senza promuoverli a prova", () => {
    expect(cloudActivityEvidence('<option>Non vende Eseguito</option>', propertyId, "Non vende", "Eseguito").found).toBe(false);
  });
  it("raccoglie tutti gli ID precedenti e distingue il nuovo Task, anche con descrizioni identiche", () => {
    const newer = { ...task, Id: "00T000000000002AAA" };
    const result = cloudActivityEvidence(JSON.stringify([task, newer]), propertyId, "Non vende", "Eseguito", new Set([task.Id.slice(0, 15)]));
    expect(result).toMatchObject({ found: true, activityId: newer.Id });
    expect(new Set(result.knownIds)).toEqual(new Set([task.Id.slice(0, 15), newer.Id.slice(0, 15)]));
    expect(cloudActivityEvidence(JSON.stringify(task), propertyId, "Non vende", "Eseguito", new Set([task.Id.slice(0, 15)])).found).toBe(false);
  });
});

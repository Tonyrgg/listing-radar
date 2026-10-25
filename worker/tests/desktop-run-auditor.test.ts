import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { runAuditDiagnosticKey } from "../src/services/run-auditor.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("sorveglianza automatica desktop", () => {
  it("conserva due proprietari e deduplica il replay anche dopo la rilettura del registro", async () => {
    // Exercise the actual desktop recording function without importing Electron
    // or opening a real Worker profile. Only its local ledger writer is replaced.
    const main = read("src/desktop/main.ts");
    const recordingFunction = main.slice(main.indexOf("async function recordRunAuditFindings("),
      main.indexOf("async function auditPersistedImport("));
    const javascript = ts.transpileModule(recordingFunction, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    let ledger: Array<{ source: string; jobId: string | null; details: Record<string, unknown> }> = [];
    const record = () => new Function("diagnosticErrors", "recordDiagnosticErrorSafely", "runAuditDiagnosticKey",
      `${javascript}; return recordRunAuditFindings;`)(ledger, async (entry: typeof ledger[number]) => {
        ledger.push(JSON.parse(JSON.stringify(entry)));
      }, runAuditDiagnosticKey);
    const context = { jobId: "job-1", runType: "import" };
    const finding = { code: "crm_person_identity_mismatch", propertyId: "property-1",
      status: "needs_review", message: "Synthetic mismatch", details: {} };
    const owners = ["person-1", "person-2"].map(sourcePersonId => ({
      ...finding, details: { sourcePersonId },
    }));
    // A historical diagnostic without a person must not suppress either owner.
    expect(await record()([finding], context)).toBe(1);
    expect(await record()(owners, context)).toBe(2);
    ledger = JSON.parse(JSON.stringify(ledger));
    expect(await record()([finding, ...owners], context)).toBe(0);
    expect(ledger).toHaveLength(3);
    expect(ledger.slice(1).map(entry => entry.details.sourcePersonId)).toEqual(["person-1", "person-2"]);
    expect(await record()([{ ...finding, details: { sourcePersonId: null } }], context)).toBe(0);
    expect(await record()(owners, { ...context, jobId: "job-2" })).toBe(2);
    expect(await record()(owners.map(owner => ({ ...owner, propertyId: "property-2" })), context)).toBe(2);
    expect(await record()(owners.map(owner => ({ ...owner, code: "crm_person_identity_missing" })), context)).toBe(2);
  });

  it("codifica le componenti senza collisioni e mantiene i record senza persona", () => {
    const base = { jobId: null, code: "code", propertyId: null };
    expect(runAuditDiagnosticKey(base)).toBe(runAuditDiagnosticKey({ ...base, sourcePersonId: null }));
    expect(runAuditDiagnosticKey({ ...base, code: "a|b", propertyId: "c" }))
      .not.toBe(runAuditDiagnosticKey({ ...base, code: "a", propertyId: "b|c" }));
  });

  it("vive nella Cronologia e non espone più una run manuale", () => {
    const html = read("src/desktop/renderer/index.html");
    const renderer = read("src/desktop/renderer/renderer.js");
    const preload = read("src/desktop/preload.cjs");
    const main = read("src/desktop/main.ts");

    expect(html).toContain("Sorveglianza automatica · attiva su ogni run");
    expect(html).not.toContain('data-scroll="collaudo"');
    expect(html).not.toContain('id="collaudoStart"');
    expect(renderer).not.toContain("startCollaudo");
    expect(preload).not.toContain("desktop:start-collaudo");
    expect(main).toContain("auditPersistedImport");
    expect(main).toContain("auditStreetRun(result, { expandAllOwners })");
    expect(main).toContain('source: "run-auditor"');
  });
});

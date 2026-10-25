import { describe, expect, it } from "vitest";

import { auditImportRun, auditStreetRun } from "../src/services/run-auditor.js";

const property = {
  id: "property-1",
  job_id: "job-1",
  municipality: "BITONTO",
  sheet: "50",
  parcel: "100",
  subaltern: "1",
  cadastral_key: "BITONTO|50|100|1",
  address: "VIA TEST n. 1",
  census_zone: "U",
  category: "A/3",
  class: "2",
  consistency: "5 vani",
  cadastral_income: 400,
  processing_status: "completed",
  crm_record_id: "crm-property-1",
  raw_payload: {
    worker_activity: {
      state: "created",
      description: "Non vende",
      status: "Eseguito",
      contactMode: "Telefonata",
      crmPropertyId: "crm-property-1",
    },
  },
};

const job = {
  id: "job-1",
  mode: "automatic",
  status: "completed",
  current_step: "completed",
  last_completed_step: "verified",
  municipality: "BITONTO",
  street: "VIA TEST",
  civic_number: null,
  sister_source_url: null,
  acquisition: { importOptions: { activityMode: "killer", importCoOwners: true, parallelCrmWindows: false } },
};

const item = {
  id: "item-1",
  property_id: "property-1",
  stage: "completed",
  status: "completed",
  plan: { source: { activity: { enabled: true, status: "Eseguito", description: "Non vende", contactMode: "Telefonata" } } },
  checkpoint: { crmPropertyId: "crm-property-1", syncedPeople: [
    { sourcePersonId: "person-1", taxCode: "RSSMRA70A01A893X", crmPersonId: "crm-person-1", mergePerformed: false },
    { sourcePersonId: "person-2", taxCode: "BNCNNA80B42A893X", crmPersonId: "crm-person-2", mergePerformed: false },
  ] },
  last_error: null,
};

describe("sorveglianza automatica delle run", () => {
  it("blocca il falso successo quando SISTER restituisce righe ma non acquisisce immobili", () => {
    const findings = auditStreetRun({
      status: "completed",
      totalRawRecords: 7,
      totalAcceptedProperties: 0,
      totalOwnersRead: 0,
      totalSkippedPropertyRows: 7,
      results: [{ warnings: ["lettura proprietari fallita"], expandedOwnerKeys: [] }],
    } as never, { expandAllOwners: true });

    expect(findings.map((finding) => finding.code)).toContain("street_false_empty_success");
    expect(findings[0]?.status).toBe("failed");
  });

  it("segnala quando lo sviluppo proprietari è attivo ma nessun intestatario viene aperto", () => {
    const findings = auditStreetRun({
      status: "completed",
      totalRawRecords: 2,
      totalAcceptedProperties: 2,
      totalOwnersRead: 3,
      totalSkippedPropertyRows: 0,
      results: [{ warnings: [], expandedOwnerKeys: [] }],
    } as never, { expandAllOwners: true });

    expect(findings.map((finding) => finding.code)).toEqual(["owner_expansion_not_executed"]);
  });

  it("conserva le incoerenze di comproprietari e attività Killer", () => {
    const findings = auditImportRun({
      job: job as never,
      graph: {
        properties: [{ ...property, raw_payload: { worker_activity: { ...property.raw_payload.worker_activity, status: "Da eseguire" } } }] as never,
        people: [] as never,
        ownerships: [
          { property_id: "property-1", person_id: "person-1" },
          { property_id: "property-1", person_id: "person-2" },
        ],
      },
      items: [{ ...item, checkpoint: { ...item.checkpoint, syncedPeople: [item.checkpoint.syncedPeople[0]] } }] as never,
    });

    expect(findings.map((finding) => finding.code)).toEqual([
      "coowners_incomplete",
      "killer_activity_incoherent",
    ]);
  });

  it("non produce rumore quando checkpoint e Cloud coincidono", () => {
    const findings = auditImportRun({
      job: job as never,
      graph: {
        properties: [property] as never,
        people: [] as never,
        ownerships: [
          { property_id: "property-1", person_id: "person-1" },
          { property_id: "property-1", person_id: "person-2" },
        ],
      },
      items: [item] as never,
    });

    expect(findings).toEqual([]);
  });

  it("usa la prova Import V2 persistita senza richiedere il checkpoint legacy sulla proprieta", () => {
    const findings = auditImportRun({
      job: job as never,
      graph: {
        properties: [{ ...property, raw_payload: {} }] as never,
        people: [] as never,
        ownerships: [
          { property_id: "property-1", person_id: "person-1" },
          { property_id: "property-1", person_id: "person-2" },
        ],
      },
      items: [{
        ...item,
        checkpoint: {
          ...item.checkpoint,
          activityEvidence: {
            activityId: null,
            outcome: "created",
            descriptionVerified: true,
            statusVerified: true,
            expectedStatus: "Eseguito",
          },
        },
      }] as never,
    });

    expect(findings).toEqual([]);
  });

  it("non segnala l'attivita disabilitata sugli immobili di espansione", () => {
    const findings = auditImportRun({
      job: job as never,
      graph: { properties: [property] as never, people: [] as never, ownerships: [] },
      items: [{
        ...item,
        plan: { source: { activity: { enabled: false, status: "Eseguito", description: null, contactMode: "Contatto diretto" } } },
        checkpoint: {
          ...item.checkpoint,
          activityEvidence: {
            activityId: null,
            outcome: "disabled",
            descriptionVerified: true,
            statusVerified: true,
            expectedStatus: "Eseguito",
          },
        },
      }] as never,
    });

    expect(findings).toEqual([]);
  });

  it("segnala quando due immobili condividono la stessa identita Cloud", () => {
    const findings = auditImportRun({
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: {
        properties: [
          { ...property, crm_record_id: "a0VRD00000ABCdeAAA" },
          { ...property, id: "property-2", cadastral_key: "BITONTO|50|200|2", crm_record_id: "a0VRD00000ABCdeBBB" },
        ] as never,
        people: [] as never,
        ownerships: [],
      },
      items: [
        { ...item, checkpoint: { ...item.checkpoint, crmPropertyId: "a0VRD00000ABCdeAAA" } },
        {
          ...item,
          id: "item-2",
          property_id: "property-2",
          checkpoint: { ...item.checkpoint, crmPropertyId: "a0VRD00000ABCdeBBB" },
        },
      ] as never,
    });

    expect(findings).toEqual([expect.objectContaining({
      code: "crm_identity_reused",
      details: expect.objectContaining({ propertyIds: ["property-1", "property-2"] }),
    })]);
  });

  it("segnala riferimenti diversi dell'immobile senza ripetere scritture", () => {
    const findings = auditImportRun({
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: { properties: [{ ...property, crm_record_id: "crm-other" }] as never, people: [], ownerships: [] },
      items: [item] as never,
    });
    expect(findings).toEqual([expect.objectContaining({
      code: "crm_identity_mismatch", propertyId: property.id,
      details: expect.objectContaining({ checkpointCrmId: "crm-property-1", propertyCrmId: "crm-other" }),
    })]);
  });

  it("accetta lo stesso ID Salesforce a 15 e 18 caratteri senza ignorare le maiuscole", () => {
    const run = (storedId: string) => auditImportRun({
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: { properties: [{ ...property, crm_record_id: storedId }] as never, people: [], ownerships: [] },
      items: [{ ...item, checkpoint: { ...item.checkpoint, crmPropertyId: "a0VRD00000ABCdeAAA" } }] as never,
    });
    expect(run(" a0VRD00000ABCde ")).toEqual([]);
    expect(run("a0vrd00000abcde").map(finding => finding.code)).toEqual(["crm_identity_mismatch"]);
  });

  it("conserva interi gli identificativi che non sono Salesforce", () => {
    const findings = auditImportRun({
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: { properties: [{ ...property, crm_record_id: "crm-property-long-record-B" }] as never, people: [], ownerships: [] },
      items: [{ ...item, checkpoint: { ...item.checkpoint, crmPropertyId: "crm-property-long-record-A" } }] as never,
    });
    expect(findings.map(finding => finding.code)).toEqual(["crm_identity_mismatch"]);
  });

  it("accetta ID persona Salesforce equivalenti e segnala riferimenti immobile mancanti", () => {
    const input = {
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: {
        properties: [property] as never,
        people: [{ id: "person-1", crm_record_id: "003RD00000ABCde" }] as never,
        ownerships: [],
      },
      items: [{ ...item, checkpoint: { ...item.checkpoint, syncedPeople: [
        { ...item.checkpoint.syncedPeople[0], crmPersonId: "003RD00000ABCdeAAA" },
      ] } }] as never,
    };
    expect(auditImportRun(input)).toEqual([]);
    for (const missing of ["checkpoint", "archive"]) {
      const findings = auditImportRun({
        ...input,
        graph: { ...input.graph, properties: [{ ...property,
          crm_record_id: missing === "archive" ? null : property.crm_record_id }] as never },
        items: [{ ...item, checkpoint: { ...item.checkpoint,
          syncedPeople: [],
          crmPropertyId: missing === "checkpoint" ? null : property.crm_record_id } }] as never,
      });
      expect(findings.map(finding => finding.code)).toEqual(["crm_identity_missing"]);
    }
  });

  it("segnala separatamente le identita discordanti o mancanti dei proprietari presenti nell'archivio", () => {
    const findings = auditImportRun({
      job: { ...job, acquisition: { importOptions: { activityMode: "plain", importCoOwners: false } } } as never,
      graph: {
        properties: [property] as never,
        people: [{ id: "person-1", crm_record_id: "crm-other-person" }, { id: "person-2", crm_record_id: null }] as never,
        ownerships: [],
      },
      items: [item] as never,
    });
    expect(findings.map(finding => [finding.code, finding.details.sourcePersonId])).toEqual([
      ["crm_person_identity_mismatch", "person-1"],
      ["crm_person_identity_missing", "person-2"],
    ]);
  });
});

import type { ImportV2Checkpoint, ImportV2Plan } from "../import-v2/model.js";
import type { ImportV2ItemRow, JobRow, PersonRow, PropertyRow } from "./repository.js";
import type { SisterStreetRunCheckpoint } from "./sister-street-run.js";

export type RunAuditFinding = {
  code: string;
  message: string;
  status: "failed" | "needs_review";
  propertyId?: string | null;
  details: Record<string, unknown>;
};

type AuditGraph = {
  properties: PropertyRow[];
  people: PersonRow[];
  ownerships: Array<{ property_id: string; person_id: string }>;
};

type PersistedActivityEvidence = {
  state?: string;
  description?: string;
  status?: string;
  contactMode?: string;
  crmPropertyId?: string;
};

function activityEvidence(property: PropertyRow | undefined): PersistedActivityEvidence | null {
  const candidate = property?.raw_payload?.worker_activity;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as PersistedActivityEvidence
    : null;
}

function completedItems(items: ImportV2ItemRow[]) {
  return items.filter((item) => item.status === "completed" && item.stage === "completed");
}

/**
 * Read-only semantic checks performed after every import run. They never
 * drive the browser and never repeat a write: their only output is a list of
 * evidence-backed inconsistencies for the persistent diagnostics ledger.
 */
export function auditImportRun(input: {
  job: JobRow;
  graph: AuditGraph;
  items: ImportV2ItemRow[];
}): RunAuditFinding[] {
  const findings: RunAuditFinding[] = [];
  const options = input.job.acquisition?.importOptions as Record<string, unknown> | undefined;
  const importCoOwners = options?.importCoOwners !== false;
  const activityMode = String(options?.activityMode ?? "");
  const propertyById = new Map(input.graph.properties.map((property) => [property.id, property]));
  const itemsByCrmProperty = new Map<string, ImportV2ItemRow[]>();
  for (const item of input.items) {
    const crmPropertyId = item.checkpoint?.crmPropertyId?.slice(0, 15);
    if (!crmPropertyId) continue;
    const grouped = itemsByCrmProperty.get(crmPropertyId) ?? [];
    grouped.push(item);
    itemsByCrmProperty.set(crmPropertyId, grouped);
  }
  for (const [crmPropertyId, grouped] of itemsByCrmProperty) {
    const propertyIds = [...new Set(grouped.map((item) => item.property_id))];
    if (propertyIds.length < 2) continue;
    findings.push({
      code: "crm_identity_reused",
      status: "needs_review",
      propertyId: propertyIds[0]!,
      message: "La stessa scheda Cloud risulta associata a più immobili SISTER: la run non può considerarli importati separatamente.",
      details: {
        crmPropertyId,
        propertyIds,
        cadastralKeys: propertyIds.map((propertyId) => propertyById.get(propertyId)?.cadastral_key ?? null),
      },
    });
  }

  for (const item of completedItems(input.items)) {
    const property = propertyById.get(item.property_id);
    const expectedOwnerIds = new Set(input.graph.ownerships
      .filter((ownership) => ownership.property_id === item.property_id)
      .map((ownership) => ownership.person_id));
    const syncedOwnerIds = new Set((item.checkpoint?.syncedPeople ?? []).map((person) => person.sourcePersonId));

    if (importCoOwners && expectedOwnerIds.size > 0
      && [...expectedOwnerIds].some((personId) => !syncedOwnerIds.has(personId))) {
      findings.push({
        code: "coowners_incomplete",
        status: "needs_review",
        propertyId: item.property_id,
        message: "La run risulta conclusa, ma non tutti i proprietari risultano verificati nel checkpoint.",
        details: {
          expectedOwners: expectedOwnerIds.size,
          syncedOwners: [...expectedOwnerIds].filter((personId) => syncedOwnerIds.has(personId)).length,
          cadastralKey: property?.cadastral_key,
          propertyAddress: property?.address,
        },
      });
    }

    if (activityMode === "killer") {
      const plan = item.plan as ImportV2Plan | null;
      const checkpoint = item.checkpoint as Partial<ImportV2Checkpoint> | null;
      const expected = plan?.source.activity;
      const persisted = activityEvidence(property);
      const importV2Evidence = checkpoint?.activityEvidence;
      const checkpointCoherent = expected?.enabled === true
        && expected.status === "Eseguito"
        && Boolean(checkpoint?.crmPropertyId)
        && ["created", "existing"].includes(String(importV2Evidence?.outcome))
        && importV2Evidence?.expectedStatus === "Eseguito"
        && importV2Evidence?.descriptionVerified === true
        && importV2Evidence?.statusVerified === true;
      const legacyCoherent = expected?.enabled === true
        && expected.status === "Eseguito"
        && Boolean(checkpoint?.crmPropertyId)
        && Boolean(persisted)
        && ["created", "existing", "manual"].includes(String(persisted?.state))
        && persisted?.status === "Eseguito"
        && persisted?.description === expected.description
        && persisted?.contactMode === expected.contactMode
        && persisted?.crmPropertyId === checkpoint?.crmPropertyId;
      const intentionallyDisabled = expected?.enabled === false && importV2Evidence?.outcome === "disabled";
      if (!intentionallyDisabled && !checkpointCoherent && !legacyCoherent) {
        findings.push({
          code: "killer_activity_incoherent",
          status: "needs_review",
          propertyId: item.property_id,
          message: "Da rifinire: attività Killer non verificata nel Cloud per questo immobile. La run è conclusa; consulta il dettaglio.",
          details: {
            expectedStatus: "Eseguito",
            plannedStatus: expected?.status ?? null,
            savedStatus: persisted?.status ?? null,
            checkpointStatus: importV2Evidence?.expectedStatus ?? null,
            checkpointOutcome: importV2Evidence?.outcome ?? null,
            descriptionVerified: importV2Evidence?.descriptionVerified ?? null,
            statusVerified: importV2Evidence?.statusVerified ?? null,
            plannedMode: expected?.contactMode ?? null,
            savedMode: persisted?.contactMode ?? null,
            cadastralKey: property?.cadastral_key,
            propertyAddress: property?.address,
          },
        });
      }
    }

    if (!item.checkpoint?.crmPropertyId || !property?.crm_record_id) {
      findings.push({
        code: "crm_identity_missing",
        status: "needs_review",
        propertyId: item.property_id,
        message: "Immobile concluso senza un riferimento Cloud verificabile nel checkpoint e nella coda.",
        details: {
          checkpointCrmId: item.checkpoint?.crmPropertyId ?? null,
          propertyCrmId: property?.crm_record_id ?? null,
          cadastralKey: property?.cadastral_key,
          propertyAddress: property?.address,
        },
      });
    }
  }

  return findings;
}

/** Detects false-success acquisitions before the UI can call them complete. */
export function auditStreetRun(
  checkpoint: SisterStreetRunCheckpoint,
  options: { expandAllOwners: boolean },
): RunAuditFinding[] {
  if (checkpoint.status !== "completed") return [];
  const findings: RunAuditFinding[] = [];
  const expandedOwners = new Set(checkpoint.results.flatMap((result) => result.expandedOwnerKeys ?? []));

  if (checkpoint.totalRawRecords > 0 && checkpoint.totalAcceptedProperties === 0) {
    findings.push({
      code: "street_false_empty_success",
      status: "failed",
      message: `SISTER ha restituito ${checkpoint.totalRawRecords} righe, ma nessun immobile Ã¨ stato acquisito: la run non viene dichiarata conclusa.`,
      details: {
        rawRecords: checkpoint.totalRawRecords,
        skippedRows: checkpoint.totalSkippedPropertyRows,
        warnings: checkpoint.results.flatMap((result) => result.warnings),
      },
    });
  }
  if (options.expandAllOwners && checkpoint.totalOwnersRead > 0 && expandedOwners.size === 0) {
    findings.push({
      code: "owner_expansion_not_executed",
      status: "failed",
      message: "Sviluppa tutti i proprietari era attivo, ma nessun proprietario Ã¨ stato aperto: la run resta da riprendere.",
      details: {
        ownersRead: checkpoint.totalOwnersRead,
        acceptedProperties: checkpoint.totalAcceptedProperties,
      },
    });
  }
  return findings;
}

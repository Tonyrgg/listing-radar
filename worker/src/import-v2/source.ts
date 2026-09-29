import type { JobRow, PersonRow, PropertyRow } from "../services/repository.js";
import type { SourceProperty } from "./model.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectAcquisitionQueue, type AcquiredGraph } from "../services/acquisition-queue.js";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { isRecoverableImportFailure } from "./recovery-policy.js";
import type { ImportV2Failure } from "./model.js";
export type { AcquiredGraph } from "../services/acquisition-queue.js";

export type ActivitySource = SourceProperty["activity"];
export type ImportV2AcquisitionEvidence = { businessOwnerRowIndexes: Set<number> };

function optionalString(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

/** Cambia solo la via acquisita in questa run, lasciando civico e dettagli SISTER intatti. */
export function addressForImport(address: string, sisterStreet: string, importStreet: string): string {
  const expected = normalizeSisterStreet(sisterStreet);
  if (!expected || !importStreet.trim()) return address;
  for (let end = 1; end <= address.length; end += 1) {
    if (normalizeSisterStreet(address.slice(0, end)) !== expected) continue;
    const suffix = address.slice(end);
    if (!/^\s*(?:,?\s*(?:N(?:\.|°|º)?\s*)?\d|,?\s*S\.?\s*N\.?\s*C\.?|$)/i.test(suffix)) continue;
    return `${importStreet.trim()}${suffix}`;
  }
  return address;
}

function rawCadastralValue(property: PropertyRow, ...keys: string[]): string | null {
  const rawCells = property.raw_payload?.rawCells;
  const cells = rawCells && typeof rawCells === "object" ? rawCells as Record<string, unknown> : {};
  for (const key of keys) {
    const value = optionalString(cells[key] ?? property.raw_payload?.[key]);
    if (value) return value;
  }
  return null;
}

/** Converts the persisted acquisition contract without importing any V1 state. */
export function importV2Sources(
  job: Pick<JobRow, "id"> & Partial<Pick<JobRow, "acquisition">>,
  graph: AcquiredGraph,
  activityFor: (property: PropertyRow, owners: PersonRow[]) => ActivitySource,
  evidence: ImportV2AcquisitionEvidence = { businessOwnerRowIndexes: new Set() },
): SourceProperty[] {
  return importV2SourceFactories(job, graph, activityFor, evidence).map((build) => build());
}

/**
 * Keeps activity selection live until each property actually starts. This is
 * important for long imports: changing Autocompila/Generica/Killer/Nessuna applies
 * to the next untouched property without altering an in-flight checkpoint.
 */
export function importV2SourceFactories(
  job: Pick<JobRow, "id"> & Partial<Pick<JobRow, "acquisition">>,
  graph: AcquiredGraph,
  activityFor: (property: PropertyRow, owners: PersonRow[]) => ActivitySource,
  evidence: ImportV2AcquisitionEvidence = { businessOwnerRowIndexes: new Set() },
): Array<() => SourceProperty> {
  const queue = inspectAcquisitionQueue(graph);
  const people = queue.index.peopleById;
  const settings = job.acquisition?.runSettings;
  const runSettings = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const sisterStreet = optionalString(runSettings.street);
  const importStreet = optionalString(runSettings.importStreet);
  return queue.activeProperties.filter((property) => {
    const prior = property.raw_payload?.import_v2 as { terminalForRun?: boolean; failure?: ImportV2Failure } | undefined;
    return prior?.terminalForRun !== true || isRecoverableImportFailure(prior.failure);
  }).map((property) => () => {
    const useImportStreet = Boolean(sisterStreet && importStreet && property.raw_payload?.long_run);
    const fullAddress = useImportStreet
      ? addressForImport(property.address ?? "", sisterStreet!, importStreet!)
      : property.address ?? "";
    const addressMismatch = useImportStreet && fullAddress === property.address
      && normalizeSisterStreet(sisterStreet!) !== normalizeSisterStreet(importStreet!);
    const links = queue.index.ownershipsByPropertyId.get(property.id) ?? [];
    const owners = links.flatMap((ownership) => {
      const person = people.get(ownership.person_id);
      if (!person) return [];
      return [{
        sourcePersonId: person.id,
        taxCode: person.tax_code ?? "",
        fullName: person.full_name,
        birthDate: person.birth_date,
        birthPlace: person.birth_place,
        birthProvince: person.birth_province,
        rightType: optionalString(ownership.right_type) ?? optionalString(person.right_type) ?? "Proprietà",
        sharePercentage: ownership.share_percentage,
        contacts: {
          phones: [...(person.mobiles ?? []), ...(person.landlines ?? [])],
          emails: person.emails ?? [],
        },
      }];
    });
    return {
      sourcePropertyId: property.id,
      ...(queue.invalidProperties.has(property.id) || addressMismatch ? {
        acquisitionError: queue.invalidProperties.get(property.id)
          ?? "L'indirizzo SISTER non corrisponde alla via scelta: controlla il nome prima dell'import Cloud",
      } : {}),
      jobId: job.id,
      municipality: property.municipality,
      fullAddress,
      cadastral: {
        urbanSection: rawCadastralValue(property, "urbanSection", "sezioneUrbana", "sezione"),
        sheet: property.sheet,
        parcel: property.parcel,
        parcelDenomination: rawCadastralValue(property, "parcelDenomination", "denomParticella"),
        subaltern: property.subaltern,
        income: property.cadastral_income,
      },
      category: property.category,
      propertyClass: property.class,
      consistency: property.consistency,
      hasBusinessOwners: evidence.businessOwnerRowIndexes.has(Number(property.raw_payload?.sourceOrder ?? property.raw_payload?.rowIndex))
        || Boolean(property.raw_payload?.acquisition
        && typeof property.raw_payload.acquisition === "object"
        && (property.raw_payload.acquisition as Record<string, unknown>).businessSubjectsPresent === true),
      activity: activityFor(property, links.flatMap((link) => people.get(link.person_id) ?? [])),
      owners,
    };
  });
}

/** Reads only historical acquisition evidence needed to protect old saved jobs. */
export async function loadImportV2AcquisitionEvidence(
  client: SupabaseClient,
  jobId: string,
): Promise<ImportV2AcquisitionEvidence> {
  const result = await client.from("property_worker_steps")
    .select("output_data")
    .eq("job_id", jobId)
    .eq("step_name", "owners_extracted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`Lettura evidenze acquisizione V2 fallita: ${result.error.message}`);
  const output = result.data?.output_data && typeof result.data.output_data === "object"
    ? result.data.output_data as Record<string, unknown>
    : {};
  const ignored = Array.isArray(output.ignoredBusinesses) ? output.ignoredBusinesses : [];
  return {
    businessOwnerRowIndexes: new Set(ignored.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const rowIndex = Number((item as Record<string, unknown>).rowIndex);
      return Number.isInteger(rowIndex) ? [rowIndex] : [];
    })),
  };
}

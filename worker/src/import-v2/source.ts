import type { JobRow, PersonRow, PropertyRow } from "../services/repository.js";
import type { SourceProperty } from "./model.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AcquiredGraph = {
  properties: PropertyRow[];
  people: PersonRow[];
  ownerships: Array<{
    id: string;
    property_id: string;
    person_id: string;
    share_percentage: number | null;
    right_type?: string | null;
  }>;
};

export type ActivitySource = SourceProperty["activity"];
export type ImportV2AcquisitionEvidence = { businessOwnerRowIndexes: Set<number> };

function isImportableAcquisition(property: PropertyRow): boolean {
  if (["acquisition_skipped", "acquisition_failed"].includes(property.processing_status)) return false;
  const acquisition = property.raw_payload?.acquisition;
  if (!acquisition || typeof acquisition !== "object") return true;
  const status = String((acquisition as Record<string, unknown>).status ?? "");
  return !["acquisition_skipped", "acquisition_failed"].includes(status);
}

function optionalString(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
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
  job: Pick<JobRow, "id">,
  graph: AcquiredGraph,
  activityFor: (property: PropertyRow, owners: PersonRow[]) => ActivitySource,
  evidence: ImportV2AcquisitionEvidence = { businessOwnerRowIndexes: new Set() },
): SourceProperty[] {
  const people = new Map(graph.people.map((person) => [person.id, person]));
  return graph.properties.filter(isImportableAcquisition).map((property) => {
    const links = graph.ownerships.filter((ownership) => ownership.property_id === property.id);
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
      jobId: job.id,
      municipality: property.municipality,
      fullAddress: property.address ?? "",
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

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalBuildingAddress } from "@/lib/property-lifecycle/buildings/address";
import {
  normalizeBuildingPracticeRows,
  parseBuildingPracticeCsv,
} from "@/lib/property-lifecycle/buildings/practices";
import { hashValue } from "@/lib/property-lifecycle/contracts/normalized-listing";

export interface BuildingPracticeImportInput {
  sourceKey: string;
  sourceUrl: string;
  csv: string;
  sourceEtag?: string | null;
  sourceLastModified?: string | null;
  observedAt?: string;
  applicationCode?: string | null;
}

export const DEFAULT_BUILDING_PRACTICE_SOURCE_KEY =
  "comune-bitonto-elenco-pratiche";
export const DEFAULT_BUILDING_PRACTICE_SOURCE_URL =
  "https://www.opendata.maggioli.cloud/dataset/4980aa37-bd65-4cee-a912-dc3b61373ab9/resource/ccd323fa-55f5-4159-9ad6-c49eba97872a/download/comune-di-bitonto-elenco-pratiche_2024.csv";

export interface BuildingPracticeImportResult {
  importRunId: string;
  status: "SUCCEEDED" | "PARTIAL";
  inputRows: number;
  eligibleRows: number;
  groupedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  duplicateRows: number;
  unmatchedRecords: number;
  buildingLinks: number;
  eventCount: number;
  warnings: string[];
}

interface DatabaseError {
  code?: string;
  message: string;
}

interface ExistingPracticeRow {
  id: string;
  source_record_key: string;
  content_hash: string;
}

function throwIfError(error: DatabaseError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

function chunks<T>(values: T[], size = 250): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function allSourcePractices(
  db: SupabaseClient,
  sourceKey: string,
): Promise<ExistingPracticeRow[]> {
  const pageSize = 1_000;
  const result: ExistingPracticeRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("building_practice_records")
      .select("id,source_record_key,content_hash")
      .eq("source_key", sourceKey)
      .order("id")
      .range(from, from + pageSize - 1);
    throwIfError(error);
    const page = (data ?? []) as ExistingPracticeRow[];
    result.push(...page);
    if (page.length < pageSize) {
      return result;
    }
  }
}

export class BuildingIntelligenceImporter {
  constructor(private readonly db: SupabaseClient) {}

  private async upsertBuilding(
    address: CanonicalBuildingAddress,
    observedAt: string,
    sourceKey: string,
  ): Promise<string> {
    const existing = await this.db
      .from("buildings")
      .select("id,attributes")
      .eq("normalized_key", address.normalizedKey)
      .maybeSingle();
    throwIfError(existing.error);
    const existingBuilding = existing.data as {
      id: string;
      attributes: Record<string, unknown>;
    } | null;
    if (existingBuilding) {
      const { error } = await this.db
        .from("buildings")
        .update({
          display_name: address.displayName,
          attributes: {
            ...existingBuilding.attributes,
            municipality: address.municipality,
            locality: address.locality,
            streetName: address.streetName,
            streetNumber: address.streetNumber,
            buildingIntelligenceSource: sourceKey,
          },
          last_seen_at: observedAt,
        })
        .eq("id", existingBuilding.id);
      throwIfError(error);
      return existingBuilding.id;
    }

    const rawText = address.displayName;
    const normalizedLocationKey = hashValue({
      municipality: address.municipality,
      locality: address.locality,
      postalCode: null,
      streetName: address.streetName,
      streetNumber: address.streetNumber,
      rawText,
    });
    const location = await this.db
      .from("locations")
      .upsert(
        {
          raw_text: rawText,
          municipality: address.municipality,
          locality: address.locality,
          street_name: address.streetName,
          street_number: address.streetNumber,
          scope_state: "IN_SCOPE",
          resolution_method: "COMUNE_BITONTO_BUILDING_PRACTICE",
          resolution_confidence: 0.95,
          precision_level: "EXACT_ADDRESS",
          evidence_source: sourceKey,
          normalized_key: normalizedLocationKey,
          metadata: {
            publicDataset: true,
            limitation: "building-level address evidence only",
          },
        },
        { onConflict: "normalized_key" },
      )
      .select("id")
      .single();
    const locationId = (location.data as { id: string } | null)?.id;
    throwIfError(location.error);
    if (!locationId) {
      throw new Error("Building-practice location upsert returned no id.");
    }
    const building = await this.db
      .from("buildings")
      .insert({
        location_id: locationId,
        normalized_key: address.normalizedKey,
        display_name: address.displayName,
        attributes: {
          municipality: address.municipality,
          locality: address.locality,
          streetName: address.streetName,
          streetNumber: address.streetNumber,
          buildingIntelligenceSource: sourceKey,
        },
        first_seen_at: observedAt,
        last_seen_at: observedAt,
      })
      .select("id")
      .single();
    throwIfError(building.error);
    const buildingId = (building.data as { id: string } | null)?.id;
    if (!buildingId) {
      throw new Error("Building-practice building insert returned no id.");
    }
    return buildingId;
  }

  private async finishRun(
    runId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.db
      .from("building_data_import_runs")
      .update({ ...values, finished_at: new Date().toISOString() })
      .eq("id", runId);
    throwIfError(error);
  }

  async importCsv(
    input: BuildingPracticeImportInput,
  ): Promise<BuildingPracticeImportResult> {
    const observedAt = input.observedAt ?? new Date().toISOString();
    const run = await this.db
      .from("building_data_import_runs")
      .insert({
        source_key: input.sourceKey,
        source_url: input.sourceUrl,
        source_etag: input.sourceEtag ?? null,
        source_last_modified: input.sourceLastModified ?? null,
        started_at: observedAt,
      })
      .select("id")
      .single();
    throwIfError(run.error);
    const importRunId = (run.data as { id: string } | null)?.id;
    if (!importRunId) {
      throw new Error("Building-practice import run returned no id.");
    }

    try {
      const normalized = normalizeBuildingPracticeRows(
        parseBuildingPracticeCsv(input.csv),
        { applicationCode: input.applicationCode ?? "ape" },
      );
      const existing = await allSourcePractices(this.db, input.sourceKey);
      const existingByKey = new Map(
        existing.map((record) => [record.source_record_key, record]),
      );
      const insertedRecords = normalized.records.filter(
        (record) => !existingByKey.has(record.sourceRecordKey),
      ).length;
      const updatedRecords = normalized.records.filter((record) => {
        const prior = existingByKey.get(record.sourceRecordKey);
        return prior != null && prior.content_hash !== record.contentHash;
      }).length;
      const unchangedRecords =
        normalized.records.length - insertedRecords - updatedRecords;

      const practiceRows = normalized.records.map((record) => ({
        source_key: input.sourceKey,
        source_record_key: record.sourceRecordKey,
        application_code: record.applicationCode,
        practice_number: record.practiceNumber,
        protocol_number: record.protocolNumber,
        practice_year: record.year,
        practice_type: record.practiceType,
        practice_status: record.practiceStatus,
        intervention_type: record.interventionType,
        occurred_at: record.occurredAt,
        source_url: input.sourceUrl,
        content_hash: record.contentHash,
        sanitized_payload: record.sanitizedPayload,
        last_seen_at: observedAt,
      }));
      const practiceIds = new Map<string, string>();
      for (const batch of chunks(practiceRows)) {
        const { data, error } = await this.db
          .from("building_practice_records")
          .upsert(batch, { onConflict: "source_key,source_record_key" })
          .select("id,source_record_key");
        throwIfError(error);
        for (const row of (data ?? []) as Array<{
          id: string;
          source_record_key: string;
        }>) {
          practiceIds.set(row.source_record_key, row.id);
        }
      }

      const changedRecords = normalized.records.filter(
        (record) =>
          existingByKey.get(record.sourceRecordKey)?.content_hash !==
          record.contentHash,
      );
      const observationRows = changedRecords.flatMap((record) => {
        const practiceRecordId = practiceIds.get(record.sourceRecordKey);
        return practiceRecordId
          ? [
              {
                practice_record_id: practiceRecordId,
                import_run_id: importRunId,
                content_hash: record.contentHash,
                sanitized_payload: record.sanitizedPayload,
                observed_at: observedAt,
              },
            ]
          : [];
      });
      for (const batch of chunks(observationRows)) {
        const { error } = await this.db
          .from("building_practice_observations")
          .upsert(batch, {
            onConflict: "practice_record_id,content_hash",
            ignoreDuplicates: true,
          });
        throwIfError(error);
      }

      const uniqueAddresses = new Map<string, CanonicalBuildingAddress>();
      for (const record of normalized.records) {
        for (const address of record.addresses) {
          uniqueAddresses.set(address.normalizedKey, address);
        }
      }
      const buildingIds = new Map<string, string>();
      for (const address of uniqueAddresses.values()) {
        buildingIds.set(
          address.normalizedKey,
          await this.upsertBuilding(address, observedAt, input.sourceKey),
        );
      }

      const links: Array<{
        practice_record_id: string;
        building_id: string;
        last_seen_at: string;
      }> = [];
      const events: Array<{
        building_id: string;
        event_type: string;
        occurred_at: string;
        source_url: string;
        confidence: number;
        dedupe_key: string;
        payload: Record<string, unknown>;
      }> = [];
      for (const record of normalized.records) {
        const practiceRecordId = practiceIds.get(record.sourceRecordKey);
        if (!practiceRecordId) {
          continue;
        }
        for (const address of record.addresses) {
          const buildingId = buildingIds.get(address.normalizedKey);
          if (!buildingId) {
            continue;
          }
          links.push({
            practice_record_id: practiceRecordId,
            building_id: buildingId,
            last_seen_at: observedAt,
          });
          events.push({
            building_id: buildingId,
            event_type: "BUILDING_PRACTICE_" + record.interventionType,
            occurred_at: record.occurredAt ?? observedAt,
            source_url: input.sourceUrl,
            confidence: record.occurredAt ? 0.9 : 0.65,
            dedupe_key:
              "building-practice:" +
              input.sourceKey +
              ":" +
              record.sourceRecordKey +
              ":" +
              record.contentHash +
              ":" +
              address.normalizedKey,
            payload: {
              practiceRecordId,
              sourceRecordKey: record.sourceRecordKey,
              applicationCode: record.applicationCode,
              interventionType: record.interventionType,
              practiceType: record.practiceType,
              practiceStatus: record.practiceStatus,
              cadastralReferences: record.cadastralReferences,
              propertyAssociation: null,
              limitation: "building-level association only",
            },
          });
        }
      }
      for (const batch of chunks(links)) {
        const { error } = await this.db
          .from("building_practice_buildings")
          .upsert(batch, { onConflict: "practice_record_id,building_id" });
        throwIfError(error);
      }
      let eventCount = 0;
      for (const batch of chunks(events)) {
        const { data, error } = await this.db
          .from("building_events")
          .upsert(batch, {
            onConflict: "dedupe_key",
            ignoreDuplicates: true,
          })
          .select("id");
        throwIfError(error);
        eventCount += data?.length ?? 0;
      }

      const status = normalized.warnings.length > 0 ? "PARTIAL" : "SUCCEEDED";
      const result: BuildingPracticeImportResult = {
        importRunId,
        status,
        inputRows: normalized.inputRows,
        eligibleRows: normalized.eligibleRows,
        groupedRecords: normalized.records.length,
        insertedRecords,
        updatedRecords,
        unchangedRecords,
        duplicateRows: normalized.duplicateRows,
        unmatchedRecords: normalized.unmatchedRecords,
        buildingLinks: links.length,
        eventCount,
        warnings: normalized.warnings,
      };
      await this.finishRun(importRunId, {
        status,
        input_rows: result.inputRows,
        eligible_rows: result.eligibleRows,
        grouped_records: result.groupedRecords,
        inserted_records: result.insertedRecords,
        updated_records: result.updatedRecords,
        duplicate_rows: result.duplicateRows,
        unmatched_records: result.unmatchedRecords,
        building_links: result.buildingLinks,
        event_count: result.eventCount,
        warnings: result.warnings,
      });
      return result;
    } catch (error) {
      await this.finishRun(importRunId, {
        status: "FAILED",
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString(),
          },
        ],
      });
      throw error;
    }
  }
}

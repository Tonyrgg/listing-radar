import { randomUUID } from "node:crypto";
import type { CadastralOwner, CadastralProperty } from "../types.js";
import type { SourceProperty } from "../import-v2/model.js";
import { isBusinessOwner } from "../core/owner-kind.js";
import { latest, unitKey, type TerritoryState } from "./model.js";
import { sourceProblem, isQuarantined } from "./quarantine.js";
import type { ExcelContactsAdapter } from "../adapters/excel/index.js";
import { consolidateOwnershipShares } from "../core/ownership-shares.js";

export function sisterSource(property: CadastralProperty, owners: CadastralOwner[], runId: string, contacts?: ExcelContactsAdapter | null): SourceProperty {
  owners = consolidateOwnershipShares(owners);
  const rawCells = property.rawPayload.rawCells as Record<string, unknown> | undefined;
  const raw = (...keys: string[]) => keys.map(key => rawCells?.[key] ?? property.rawPayload[key]).find(value => typeof value === "string" && value.trim()) as string | undefined;
  return { sourcePropertyId: randomUUID(), jobId: runId, municipality: property.municipality.trim().toUpperCase(), fullAddress: property.address ?? "",
    cadastral: { urbanSection: raw("urbanSection", "sezioneUrbana", "sezione")?.trim() ?? null, sheet: property.sheet, parcel: property.parcel, parcelDenomination: raw("parcelDenomination", "denomParticella")?.trim() ?? null, subaltern: property.subaltern, income: property.cadastralIncome },
    category: property.category, propertyClass: property.class, consistency: property.consistency, hasBusinessOwners: owners.some(owner => isBusinessOwner(owner.fullName, owner.taxCode)),
    activity: { enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" },
    owners: owners.map(owner => {
      const match = contacts?.findByTaxCode(owner.taxCode ?? "");
      const parts = (owner.rawPayload.consolidatedOwnershipRows as CadastralOwner[] | undefined) ?? [owner];
      return { sourcePersonId: randomUUID(), taxCode: owner.taxCode ?? "", fullName: owner.fullName, birthDate: owner.birthDate, birthPlace: owner.birthPlace, birthProvince: owner.birthProvince, rightType: owner.rightType, sharePercentage: owner.sharePercentage,
        ownershipParts: parts.map(part => ({ rightType: part.rightType, shareOriginal: part.shareOriginal })),
        contacts: { phones: [...(match?.mobiles ?? []), ...(match?.landlines ?? [])], emails: match?.emails ?? [] } };
    }) };
}
/** Reuse only a complete original reading whose current inventory fields agree. */
export function reusableSisterSource(state: TerritoryState, row: SourceProperty): SourceProperty | null {
  let key: string; try { key = unitKey(row); } catch { return null; }
  const unit = state.units[key]; if (!unit || isQuarantined(state, unit)) return null;
  const observation = latest(unit), source = observation.source;
  if (observation.origin !== "sister" || !observation.ownersComplete || sourceProblem(source)) return null;
  const text = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (text(source.fullAddress) !== text(row.fullAddress) || text(source.category) !== text(row.category)
    || text(source.propertyClass) !== text(row.propertyClass) || text(source.consistency) !== text(row.consistency)
    || source.cadastral.income !== row.cadastral.income || text(source.cadastral.parcelDenomination) !== text(row.cadastral.parcelDenomination)) return null;
  return structuredClone(source);
}

import { canonicalEmail, canonicalPhone, splitSourcePersonName } from "./identity.js";
import type { CrmPersonSnapshot, SourceOwner } from "./model.js";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export type PersonWriteModel = {
  taxCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthPlace: string | null;
  birthProvince: string | null;
  phones: string[];
  emails: string[];
  privateNotes: string | null;
};

/**
 * SISTER wins for supplied personal data. Empty source values are deliberately
 * ignored. Phones are a lossless union. Tecnocloud exposes two email slots:
 * imported addresses have priority, then existing addresses fill free slots.
 */
export function personWriteModel(source: SourceOwner, existing: CrmPersonSnapshot | null): PersonWriteModel {
  const sourcePhones = source.contacts.phones.map(canonicalPhone).filter(Boolean);
  const existingPhones = (existing?.phones ?? []).map(canonicalPhone).filter(Boolean);
  const sourceEmails = source.contacts.emails.map(canonicalEmail).filter(Boolean);
  const existingEmails = (existing?.emails ?? []).map(canonicalEmail).filter(Boolean);
  const fullName = source.fullName.trim() || existing?.fullName || "";
  const name = splitSourcePersonName(fullName, source.taxCode);
  return {
    taxCode: source.taxCode,
    fullName,
    firstName: name.firstName,
    lastName: name.lastName,
    birthDate: source.birthDate || existing?.birthDate || null,
    birthPlace: source.birthPlace?.trim() || existing?.birthPlace || null,
    birthProvince: source.birthProvince?.trim() || existing?.birthProvince || null,
    // The four CRM slots are finite: existing numbers keep their positions and
    // imported numbers occupy only the remaining capacity.
    phones: unique([...existingPhones, ...sourcePhones]).slice(0, 4),
    emails: unique([...sourceEmails, ...existingEmails]).slice(0, 2),
    privateNotes: source.privateNotes?.trim() || null,
  };
}

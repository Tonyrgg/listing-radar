import { canonicalEmail, canonicalPhone, formatPersonName, splitSourcePersonName } from "./identity.js";
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

export const PHONE_FIELD_LABELS = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"] as const;
export type PhoneFieldLabel = (typeof PHONE_FIELD_LABELS)[number];

export type PhoneFieldAssignment = {
  values: Record<PhoneFieldLabel, string>;
  overflow: string[];
};

/**
 * Tecnocloud distingue il cellulare dal fisso, quindi l'ordine della sorgente
 * non puo' decidere il campo. Per la numerazione italiana il prefisso 3 e'
 * mobile e lo 0 e' geografico; eventuali numeri speciali vanno soltanto nel
 * campo neutro, mai spacciati per cellulari o fissi.
 */
export function assignPhonesToFields(phones: string[]): PhoneFieldAssignment {
  const normalized = unique(phones.map(canonicalPhone).filter(Boolean));
  const mobiles = normalized.filter((phone) => phone.startsWith("3"));
  const landlines = normalized.filter((phone) => phone.startsWith("0"));
  const neutral = normalized.filter((phone) => !phone.startsWith("3") && !phone.startsWith("0"));
  const values: Record<PhoneFieldLabel, string> = {
    Cellulare: mobiles.shift() ?? "",
    "Telefono fisso": landlines.shift() ?? "",
    "Telefono Ufficio": landlines.shift() ?? "",
    "Altro telefono": "",
  };
  const remaining = [...mobiles, ...landlines, ...neutral];
  values["Altro telefono"] = remaining.shift() ?? "";
  return { values, overflow: remaining };
}

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
  const fullName = formatPersonName(source.fullName.trim() || existing?.fullName || "");
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

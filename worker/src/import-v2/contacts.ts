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

export function assignPhonesToAvailableFields(
  phones: string[],
  availableLabels: readonly PhoneFieldLabel[] = PHONE_FIELD_LABELS,
): PhoneFieldAssignment {
  const normalized = unique(phones.map(canonicalPhone).filter(Boolean));
  const available = new Set(availableLabels);
  const values = Object.fromEntries(PHONE_FIELD_LABELS.map((label) => [label, ""])) as Record<PhoneFieldLabel, string>;
  const overflow: string[] = [];
  const candidates = (phone: string): PhoneFieldLabel[] => phone.startsWith("3")
    ? ["Cellulare", "Altro telefono", "Telefono Ufficio"]
    : phone.startsWith("0")
      ? ["Telefono fisso", "Telefono Ufficio", "Altro telefono"]
      : ["Altro telefono", "Telefono Ufficio"];
  for (const phone of normalized) {
    const target = candidates(phone).find((label) => available.has(label) && !values[label]);
    if (target) values[target] = phone;
    else overflow.push(phone);
  }
  return { values, overflow };
}

/**
 * Tecnocloud distingue il cellulare dal fisso, quindi l'ordine della sorgente
 * non puo' decidere il campo. Per la numerazione italiana il prefisso 3 e'
 * mobile e lo 0 e' geografico; eventuali numeri speciali vanno soltanto nel
 * campo neutro, mai spacciati per cellulari o fissi.
 */
export function assignPhonesToFields(phones: string[]): PhoneFieldAssignment {
  return assignPhonesToAvailableFields(phones);
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

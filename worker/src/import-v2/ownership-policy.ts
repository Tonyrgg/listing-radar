import type { CrmOwnershipSnapshot } from "./model.js";

export function normalizedOwnershipRight(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("it-IT");
}

/** Full, ordinary and bare ownership are managed; usufruct is out of scope. */
export function isManagedOwnershipRight(value: unknown): boolean {
  const right = normalizedOwnershipRight(value);
  return /^(?:(?:piena|nuda)\s+)?proprieta(?:\s|$)/.test(right)
    || /^(?:nudo\s+)?proprietari[oa](?:\s|$)/.test(right);
}

export function isPrivateFiscalCode(value: unknown): boolean {
  return /^[A-Z0-9]{16}$/.test(String(value ?? "").replace(/\s+/g, "").toUpperCase());
}

/** Unknown, corporate and usufruct links are protected from V2 mutations. */
export function isManagedCrmOwnership(owner: Pick<CrmOwnershipSnapshot, "taxCode" | "rightType" | "role">): boolean {
  if (!isPrivateFiscalCode(owner.taxCode)) return false;
  const right = normalizedOwnershipRight(owner.rightType);
  if (/^usufrutt/.test(right)) return false;
  const role = normalizedOwnershipRight(owner.role);
  if (/^(?:proprietario principale|comproprietario)(?:\s|$)/.test(role)) return true;
  return isManagedOwnershipRight(owner.rightType);
}

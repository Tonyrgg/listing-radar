/** Keep synthetic/non-Salesforce IDs intact; Salesforce 18-char IDs include a checksum. */
export function crmRecordIdentity(value: string): string {
  const id = value.trim();
  return /^[a-zA-Z0-9]{18}$/.test(id) ? id.slice(0, 15) : id;
}

export function sameCrmRecordId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left?.trim() && right?.trim()) && crmRecordIdentity(left!) === crmRecordIdentity(right!);
}

import type { CadastralOwner } from "../types.js";
import { isOwnershipRight } from "./owner-parser.js";
import { normalizeTaxCode } from "./normalize.js";

function gcd(a: bigint, b: bigint): bigint { return b ? gcd(b, a % b) : a; }
function fraction(value: string): [bigint, bigint] | null {
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
  if (!match || value.length > 100) return null;
  const decimal = (text: string): [bigint, bigint] => {
    const [whole, decimals = ""] = text.replace(",", ".").split(".");
    return [BigInt(whole! + decimals), 10n ** BigInt(decimals.length)];
  };
  const [a, b] = decimal(match[1]!), [c, d] = decimal(match[2]!);
  return a > 0n && c > 0n ? [a * d, b * c] : null;
}

/** Rows are shares of the same property, never a person's global quota.
 * Fiscal identity is mandatory. Usufruct and other rights remain separate.
 * Keep every original row, including equal fractions, as acquisition evidence.
 */
export function consolidateOwnershipShares(owners: CadastralOwner[]): CadastralOwner[] {
  const groups = new Map<string, CadastralOwner[]>();
  for (const owner of owners) {
    const cf = normalizeTaxCode(owner.taxCode);
    if (isOwnershipRight(owner.rightType) && /^(?:[A-Z0-9]{16}|\d{11})$/.test(cf)) {
      const group = groups.get(cf) ?? []; group.push(owner); groups.set(cf, group);
    }
  }
  const emitted = new Set<string>();
  return owners.flatMap(owner => {
    const cf = normalizeTaxCode(owner.taxCode), group = groups.get(cf);
    if (!isOwnershipRight(owner.rightType) || !group || group.length < 2) return [owner];
    if (emitted.has(cf)) return [];
    const parts = group.map(row => fraction(row.shareOriginal));
    if (parts.some(part => !part)) return [owner]; // Never conceal an invalid share.
    let n = 0n, d = 1n;
    for (const part of parts) {
      const [a, b] = part!; n = n * b + a * d; d *= b;
      const divisor = gcd(n, d); n /= divisor; d /= divisor;
    }
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)) return [owner];
    emitted.add(cf);
    return [{ ...owner, shareOriginal: `${n}/${d}`, shareNumerator: Number(n), shareDenominator: Number(d),
      sharePercentage: Number((Number(n) / Number(d) * 100).toFixed(6)),
      rawPayload: { ...owner.rawPayload, consolidatedOwnershipRows: structuredClone(group) } }];
  });
}

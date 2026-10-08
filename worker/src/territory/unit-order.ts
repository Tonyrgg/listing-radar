import { extractFirstCivicNumber, parsePropertyAddress, splitCivicNumberAndLetter } from "../core/normalize.js";
import { extractPropertyFloors } from "../core/network-exploration.js";
import type { SourceProperty } from "../import-v2/model.js";

const natural = new Intl.Collator("it", { numeric: true, sensitivity: "base" });
export function unitPosition(source: SourceProperty) {
  // Strip piano/scala/interno before reading the civic: their numbers are not civics.
  const civic = extractFirstCivicNumber(parsePropertyAddress(source.fullAddress).address);
  return { civic, floors: [...new Set(extractPropertyFloors(source.fullAddress))].sort((a, b) => a - b) };
}
const knownFirst = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? natural.compare(a, b) : a ? -1 : b ? 1 : 0;
export function compareSourceProperties(a: SourceProperty, b: SourceProperty): number {
  const ap = unitPosition(a), bp = unitPosition(b);
  const ac = ap.civic && ap.civic !== "." ? splitCivicNumberAndLetter(ap.civic) : null;
  const bc = bp.civic && bp.civic !== "." ? splitCivicNumberAndLetter(bp.civic) : null;
  const civic = knownFirst(ac?.number, bc?.number) || natural.compare(ac?.letter ?? "", bc?.letter ?? "");
  if (civic) return civic;
  if (!ap.floors.length !== !bp.floors.length) return ap.floors.length ? -1 : 1;
  for (let i = 0; i < Math.min(ap.floors.length, bp.floors.length); i++) {
    const floor = ap.floors[i]! - bp.floors[i]!;
    if (floor) return floor;
  }
  if (ap.floors.length !== bp.floors.length) return ap.floors.length - bp.floors.length;
  for (const field of ["sheet", "parcel", "subaltern", "urbanSection", "parcelDenomination"] as const) {
    const comparison = knownFirst(a.cadastral[field]?.trim(), b.cadastral[field]?.trim());
    if (comparison) return comparison;
  }
  return natural.compare(a.fullAddress, b.fullAddress) || natural.compare(a.sourcePropertyId, b.sourcePropertyId);
}

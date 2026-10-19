import { normalizeStreetName } from "@/lib/street-registry/official-inventory";
import { canonicalBuildingAddress } from "./address";
import { PUBLIC_RECORD_POLICY as P } from "./public-record-policy";
export interface RegistryStreet { id: string; canonical_name: string; official_type?: string; official_description?: string; locality: string | null; geometry?: unknown }
export interface TerritorialReference {
  streetId: string; streetName: string; locality: string; civicText: string | null; civics: string[];
  scope: "BUILDING" | "STREET"; confidence: number; civicState: "EXPLICIT" | "RANGE" | "SNC" | "MISSING";
  matcherVersion: string; reasons: string[]; normalizedKeys: string[]; candidateStreetIds?:string[];
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
const expand = (s: string) => normalizeStreetName(s).replace(/^V LE /,"VIALE ").replace(/^P ZZA /,"PIAZZA ").replace(/^C SO /,"CORSO ").replace(/\bPROFESSOR(?:E)?\b/g,"PROF").replace(/\bDOTTOR(?:E)?\b/g,"DOTT").replace(/\bSS\b/g,"SANTI");
function streetPattern(name: string) {
  const words = expand(name).split(" ");
  const kinds: Record<string,string> = { VIA:"VIA", VIALE:"(?:VIALE|V\\.?\\s*LE)", PIAZZA:"(?:PIAZZA|P\\.?\\s*ZZA)", CORSO:"(?:CORSO|C\\.?\\s*SO)" };
  return new RegExp("\\b" + words.map((w,i) => i===0 ? (kinds[w]??escape(w)) : w.length > 3 && !["DELLA","DELLE","SANTI","SANTA","SANTO"].includes(w) ? `(?:${escape(w)}|${escape(w[0])}\\.)` : escape(w)).join("[\\s.]+") + "\\b","g");
}
export function extractTerritorialReferences(text: string, streets: RegistryStreet[]): TerritorialReference[] {
  const body = fold(text), candidates: Array<{ street: RegistryStreet; start: number; end: number }> = [];
  for (const street of streets) {
    if (!/^(?:VIA|VIALE|PIAZZA|CORSO|STRADA|CONTRADA|CORTE|VICO|LARGO|TRAVERSA|VICOLO)\b/.test(expand(street.canonical_name))) continue;
    const aliases = new Set([street.canonical_name, `${street.official_type??""} ${street.official_description??""}`.trim()].filter(Boolean));
    for (const alias of aliases) for (const match of body.matchAll(streetPattern(alias))) candidates.push({street,start:match.index!,end:match.index!+match[0].length});
  }
  // An abbreviated spelling which resolves to more than one official street is not auto-resolved.
  const chosen = candidates.filter(c => !candidates.some(o => o.start===c.start && o.end>c.end) && new Set(candidates.filter(o=>o.start===c.start && o.end===c.end).map(o=>expand(o.street.canonical_name)+":"+(o.street.locality??""))).size===1);
  const result = new Map<string,TerritorialReference>();
  for (const c of chosen) {
    const candidateIds=[...new Set(candidates.filter(o=>o.start===c.start&&o.end===c.end).map(o=>o.street.id))].sort();
    const registryAmbiguous=candidateIds.length>1;
    const tail = body.slice(c.end), m = tail.match(/^\s*,?\s*(?:(?:CIV(?:ICI|ICO|V)?|N)\.?\s*)?(\d+\s*[A-Z]?(?:\s*[/,\-]\s*\d+\s*[A-Z]?){0,5}|S\.?N\.?C\.?)\b/);
    const raw = m?.[1]?.trim() ?? null, range = raw != null && /\d\s*-\s*\d/.test(raw), snc = raw != null && /^S\.?N\.?C/i.test(raw);
    const civics = !raw || range || snc ? [] : [...new Set(raw.split(/[/,]/).map(v=>v.replace(/\s/g,"").toLowerCase()))];
    const locality = /MARIOTTO/i.test(c.street.locality??"") ? "Mariotto" : /PALOMBAIO/i.test(c.street.locality??"") ? "Palombaio" : "Bitonto";
    const addresses = registryAmbiguous?[]:civics.map(civic => canonicalBuildingAddress({municipality:"Bitonto",locality,scope:"IN_SCOPE",precision:"EXACT_ADDRESS",streetName:c.street.canonical_name,streetNumber:civic})).filter(a=>a!=null);
    const ref: TerritorialReference = { streetId:registryAmbiguous?"":c.street.id, streetName:c.street.canonical_name, locality, civicText:raw, civics,
      scope:addresses.length?"BUILDING":"STREET", confidence:addresses.length?P.confidence.building:P.confidence.street,
      civicState:range?"RANGE":snc?"SNC":civics.length?"EXPLICIT":"MISSING",matcherVersion:P.matcherVersion,
      reasons:[registryAmbiguous?"official_registry_duplicate_requires_review":"official_street_unique",range?"civic_range_not_expanded":snc?"snc_no_civic":civics.length?"explicit_civic":"street_only","property_unit_not_asserted"], normalizedKeys:addresses.map(a=>a.normalizedKey),candidateStreetIds:registryAmbiguous?candidateIds:undefined };
    result.set(`${ref.streetName}:${ref.locality}:${raw??""}`,ref);
  }
  return [...result.values()];
}

/** Declared identifiers only. No cadastral resolver or property identity is implied. */
export function extractDeclaredCadastralReferences(text:string){
  const rows:Array<{sheet:string;parcel:string|null;subaltern:string|null}>=[];
  const matches=[...text.matchAll(/\bfoglio\s*(?:n\.?\s*)?(\d{1,5})\b/gi)];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],tail=text.slice(m.index!+m[0].length,Math.min(matches[i+1]?.index??text.length,m.index!+200));
    const parcel=tail.match(/\b(?:particell[ae]|mappal[ei]|p\.lla)\s*(?:n\.?\s*)?(\d+(?:\s*[,/]\s*\d+)*)/i)?.[1]??null;
    const subaltern=tail.match(/\bsub(?:altern[oi])?\.?\s*(?:n\.?\s*)?(\d+(?:\s*[,/]\s*\d+)*)/i)?.[1]??null;
    rows.push({sheet:m[1],parcel,subaltern});
  }
  return rows;
}

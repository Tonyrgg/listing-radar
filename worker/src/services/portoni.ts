import type { ContactMatchResult, CadastralOwner, CadastralProperty } from "../types.js";

export type PortoniOutcome = "" | "assente" | "parlato" | "interessato" | "non_interessato";

export type PortoniRow = {
  id: string;
  cadastralKey: string;
  sisterNames: string;
  actualNames: string;
  civicAndStair: string;
  floorAndInternal: string;
  telephone: string;
  outcome: PortoniOutcome;
  visitedAt: string;
  notes: string;
  category: string;
  ownership: string;
};

export type PortoniSheet = {
  id: string;
  street: string;
  municipality: "BITONTO";
  status: "draft" | "generated";
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  documentPath: string | null;
  rows: PortoniRow[];
};

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

function addressPart(address: string | null, pattern: RegExp): string {
  return clean(address).match(pattern)?.[1]?.trim() ?? "";
}

export function propertyLocation(property: CadastralProperty) {
  const address = clean(property.address);
  const civic = address.match(/(?:\bN\.?\s*|\bCIV(?:ICO)?\s*)(\d+[A-Z]?)/i)?.[1]
    ?? address.match(/\b(\d+[A-Z]?)\b/)?.[1]
    ?? "";
  const stair = addressPart(property.address, /\bSCALA\s+([A-Z0-9-]+)/i);
  const floor = addressPart(property.address, /\bPIANO\s+([A-Z0-9-]+)/i);
  const internal = addressPart(property.address, /\bINT(?:ERNO)?\.?\s+([A-Z0-9-]+)/i);
  return {
    civicAndStair: [civic && `Civico ${civic}`, stair && `Scala ${stair}`].filter(Boolean).join(" · "),
    floorAndInternal: [floor && `Piano ${floor}`, internal && `Interno ${internal}`].filter(Boolean).join(" · "),
    civicNumber: Number.parseInt(civic, 10) || Number.MAX_SAFE_INTEGER,
    civicSuffix: civic.replace(/^\d+/, ""),
    stair,
    floor,
    internal,
  };
}

export function buildPortoniRow(
  property: CadastralProperty,
  owners: CadastralOwner[],
  contactsFor: (taxCode: string) => ContactMatchResult,
): PortoniRow {
  const location = propertyLocation(property);
  const names = owners.map((owner) => clean(owner.fullName)).filter(Boolean);
  const phones = owners.flatMap((owner) => {
    if (!owner.taxCode) return [];
    const match = contactsFor(owner.taxCode);
    return [...match.mobiles, ...match.landlines, ...match.whatsapp, ...match.overflowPhones];
  });
  const ownership = owners.map((owner) => {
    const right = clean(owner.rightType);
    const share = clean(owner.shareOriginal);
    return [clean(owner.fullName), [right, share].filter(Boolean).join(" ")].filter(Boolean).join(": ");
  }).filter(Boolean);
  return {
    id: `${property.municipality}|${property.sheet}|${property.parcel}|${property.subaltern}`,
    cadastralKey: `${property.sheet}/${property.parcel}/${property.subaltern}`,
    sisterNames: [...new Set(names)].join("\n"),
    actualNames: "",
    civicAndStair: location.civicAndStair,
    floorAndInternal: location.floorAndInternal,
    telephone: [...new Set(phones.map(clean).filter(Boolean))].join("\n"),
    outcome: "",
    visitedAt: "",
    notes: "",
    category: clean(property.category),
    ownership: ownership.join("\n"),
  };
}

export function sortPortoniRows(rows: PortoniRow[]): PortoniRow[] {
  const collator = new Intl.Collator("it", { numeric: true, sensitivity: "base" });
  return [...rows].sort((left, right) => {
    const a = left.civicAndStair.match(/\d+/)?.[0];
    const b = right.civicAndStair.match(/\d+/)?.[0];
    const numeric = (a ? Number(a) : Number.MAX_SAFE_INTEGER) - (b ? Number(b) : Number.MAX_SAFE_INTEGER);
    return numeric || collator.compare(left.civicAndStair, right.civicAndStair)
      || collator.compare(left.floorAndInternal, right.floorAndInternal)
      || collator.compare(left.cadastralKey, right.cadastralKey);
  });
}

const html = (value: unknown) => String(value ?? "").trim().replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!)).replace(/\n/g, "<br>");

export function portoniDocumentHtml(sheet: PortoniSheet): string {
  const rows = sortPortoniRows(sheet.rows).map((row) => `<tr>
    <td>${html(row.sisterNames)}${row.ownership ? `<small>${html(row.ownership)}</small>` : ""}</td>
    <td>${html(row.actualNames)}</td><td>${html(row.civicAndStair)}</td><td>${html(row.floorAndInternal)}</td>
    <td>${html(row.telephone)}</td><td>${html(row.outcome.replaceAll("_", " "))}${row.visitedAt ? `<small>${html(row.visitedAt)}</small>` : ""}</td>
    <td>${html(row.notes)}</td><td><small>${html(row.category)} · ${html(row.cadastralKey)}</small></td>
  </tr>`).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font:10px Arial,sans-serif;color:#142f32;margin:0}
    header{display:flex;justify-content:space-between;align-items:end;margin-bottom:8mm}h1{font-size:22px;margin:0}p{margin:3px 0;color:#526467}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th,td{border:1px solid #8da0a2;padding:6px;vertical-align:top;overflow-wrap:anywhere}
    th{background:#e6efec;text-align:left;font-size:9px;text-transform:uppercase}td small{display:block;color:#526467;margin-top:4px;font-size:8px}
    th:nth-child(1){width:18%}th:nth-child(2){width:15%}th:nth-child(3){width:11%}th:nth-child(4){width:10%}th:nth-child(5){width:12%}th:nth-child(6){width:10%}th:nth-child(7){width:16%}th:nth-child(8){width:8%}
    tr{break-inside:avoid}
  </style></head><body><header><div><p>LISTING RADAR · SCHEDA PORTONI</p><h1>${html(sheet.street)}</h1></div><p>Bitonto · ${html(new Date(sheet.updatedAt).toLocaleDateString("it-IT"))} · ${sheet.rows.length} immobili</p></header>
  <table><thead><tr><th>Nominativi SISTER</th><th>Nominativi effettivi</th><th>Civico e scala</th><th>Piano e interno</th><th>Telefono</th><th>Esito e data</th><th>Note</th><th>Dati catastali</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

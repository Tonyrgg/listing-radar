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

function shortOwnerName(value: string): string {
  return clean(value).replace(/\s+nato\/?a\s+a\s+.*$/i, "").trim();
}

function italianBirthDate(owner: CadastralOwner): string {
  const sourceDate = clean(owner.birthDate)
    || clean(owner.fullName).match(/\bil\s+(\d{2}\/\d{2}\/\d{4})\b/i)?.[1]
    || "";
  const iso = sourceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : sourceDate;
}

function ownerLine(owner: CadastralOwner): string {
  return [shortOwnerName(owner.fullName), [clean(owner.rightType), clean(owner.shareOriginal)].filter(Boolean).join(" "), italianBirthDate(owner)]
    .filter(Boolean).join(" · ");
}

/** Compatta anche le schede 0.33.19, che separavano nome e diritto duplicando il nominativo. */
export function portoniOwnerSummary(row: Pick<PortoniRow, "sisterNames" | "ownership">): string {
  if (!row.ownership.trim()) return row.sisterNames.split("\n").map(clean).filter(Boolean).join("\n");
  return row.ownership.split("\n").map((entry) => {
    const separator = entry.lastIndexOf(":");
    const nameSource = separator >= 0 ? entry.slice(0, separator) : entry;
    const details = separator >= 0 ? clean(entry.slice(separator + 1)) : "";
    const date = clean(nameSource).match(/\bil\s+(\d{2}\/\d{2}\/\d{4})\b/i)?.[1] ?? "";
    return [shortOwnerName(nameSource), details, date].filter(Boolean).join(" · ");
  }).filter(Boolean).join("\n");
}

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
  const names = owners.map(ownerLine).filter(Boolean);
  const phones = owners.flatMap((owner) => {
    if (!owner.taxCode) return [];
    const match = contactsFor(owner.taxCode);
    return [...match.mobiles, ...match.landlines, ...match.whatsapp, ...match.overflowPhones];
  });
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
    ownership: "",
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
  const pages: PortoniRow[][] = [];
  let page: PortoniRow[] = [];
  let units = 0;
  for (const row of sortPortoniRows(sheet.rows)) {
    const ownerLines = Math.max(1, portoniOwnerSummary(row).split("\n").length);
    const noteLines = Math.max(1, Math.ceil(clean(row.notes).length / 42));
    const rowUnits = Math.max(1, ownerLines * 0.7, noteLines * 0.65);
    if (page.length && units + rowUnits > 42) {
      pages.push(page);
      page = [];
      units = 0;
    }
    page.push(row);
    units += rowUnits;
  }
  if (page.length || !pages.length) pages.push(page);
  const content = pages.map((rows, pageIndex) => `<section class="print-page">
    <header><div><p>LISTING RADAR · SCHEDA PORTONI</p><h1>${html(sheet.street)}</h1></div><p>Bitonto · ${html(new Date(sheet.updatedAt).toLocaleDateString("it-IT"))} · pagina ${pageIndex + 1}/${pages.length}</p></header>
    <table><thead><tr><th>Nominativi SISTER</th><th>Nominativi effettivi</th><th>Civico e scala</th><th>Piano e interno</th><th>Telefono</th><th>Note</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${html(portoniOwnerSummary(row))}</td><td>${html(row.actualNames)}</td><td>${html(row.civicAndStair)}</td>
      <td>${html(row.floorAndInternal)}</td><td>${html(row.telephone)}</td><td>${html(row.notes)}</td>
    </tr>`).join("")}</tbody></table>
    <footer><b>Note aggiuntive</b><span></span><span></span><span></span></footer>
  </section>`).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
    @page{size:A4 portrait;margin:6mm}*{box-sizing:border-box}body{font:9px/1.25 Arial,sans-serif;color:#142f32;margin:0}
    .print-page{height:284mm;display:flex;flex-direction:column;break-after:page}.print-page:last-child{break-after:auto}
    header{display:flex;justify-content:space-between;align-items:end;margin-bottom:3mm}h1{font-size:16px;margin:0}p{margin:2px 0;color:#526467}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #8da0a2;padding:3px 4px;vertical-align:top;overflow-wrap:anywhere}
    th{background:#e6efec;text-align:left;font-size:8px;text-transform:uppercase}tr{break-inside:avoid}
    th:nth-child(1){width:23%}th:nth-child(2){width:15%}th:nth-child(3){width:10%}th:nth-child(4){width:10%}th:nth-child(5){width:14%}th:nth-child(6){width:28%}
    footer{margin-top:auto;padding-top:3mm;font-size:9px}footer b{display:block;margin-bottom:1mm;text-transform:uppercase}footer span{display:block;height:7mm;border-bottom:1px solid #8da0a2}
  </style></head><body>${content}</body></html>`;
}

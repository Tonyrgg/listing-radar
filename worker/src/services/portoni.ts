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
  const rows = sortPortoniRows(sheet.rows).map((row) => `<tr data-portoni-source-row>
      <td>${html(portoniOwnerSummary(row))}</td><td>${html(row.actualNames)}</td><td>${html(row.civicAndStair)}</td>
      <td>${html(row.floorAndInternal)}</td><td>${html(row.telephone)}</td><td>${html(row.notes)}</td>
    </tr>`).join("");
  const updatedAt = html(new Date(sheet.updatedAt).toLocaleDateString("it-IT"));
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
    @page{size:A4 portrait;margin:6mm}*{box-sizing:border-box}body{font:9px/1.25 Arial,sans-serif;color:#142f32;margin:0}
    .print-page{height:284mm;display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;break-after:page}.print-page:last-child{break-after:auto}
    header{display:flex;justify-content:space-between;align-items:end;margin-bottom:3mm}h1{font-size:16px;margin:0}p{margin:2px 0;color:#526467}
    .table-zone{min-height:0;overflow:hidden}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #8da0a2;padding:3px 4px;vertical-align:top;overflow-wrap:anywhere}
    th{background:#e6efec;text-align:left;font-size:8px;text-transform:uppercase}tr{break-inside:avoid}
    th:nth-child(1){width:23%}th:nth-child(2){width:15%}th:nth-child(3){width:10%}th:nth-child(4){width:10%}th:nth-child(5){width:14%}th:nth-child(6){width:28%}
    footer{padding-top:3mm;font-size:9px}footer b{display:block;margin-bottom:1mm;text-transform:uppercase}footer span{display:block;height:7mm;border-bottom:1px solid #8da0a2}
  </style></head><body><main id="portoni-pages"></main>
  <template id="portoni-page-template"><section class="print-page">
    <header><div><p>LISTING RADAR · SCHEDA PORTONI</p><h1>${html(sheet.street)}</h1></div><p>Bitonto · ${updatedAt} · pagina <span data-page-number></span>/<span data-page-total></span></p></header>
    <div class="table-zone"><table><thead><tr><th>Nominativi SISTER</th><th>Nominativi effettivi</th><th>Civico e scala</th><th>Piano e interno</th><th>Telefono</th><th>Note</th></tr></thead><tbody></tbody></table></div>
    <footer><b>Note aggiuntive</b><span></span><span></span><span></span></footer>
  </section></template>
  <template id="portoni-row-source"><table><tbody>${rows}</tbody></table></template>
  <script>
    (async () => {
      await document.fonts.ready;
      const pagesRoot = document.getElementById("portoni-pages");
      const pageTemplate = document.getElementById("portoni-page-template");
      const rowSource = document.getElementById("portoni-row-source");
      const sourceRows = Array.from(rowSource.content.querySelectorAll("tr"));
      const addBlankPage = () => {
        const page = pageTemplate.content.firstElementChild.cloneNode(true);
        pagesRoot.append(page);
        return {
          page,
          zone: page.querySelector(".table-zone"),
          table: page.querySelector("table"),
          body: page.querySelector("tbody"),
        };
      };
      let current = addBlankPage();
      for (const sourceRow of sourceRows) {
        const row = sourceRow.cloneNode(true);
        current.body.append(row);
        if (current.table.scrollHeight > current.zone.clientHeight + 1 && current.body.children.length > 1) {
          row.remove();
          current = addBlankPage();
          current.body.append(row);
        }
      }
      const pages = Array.from(pagesRoot.querySelectorAll(".print-page"));
      for (const [index, page] of pages.entries()) {
        page.querySelector("[data-page-number]").textContent = String(index + 1);
        page.querySelector("[data-page-total]").textContent = String(pages.length);
      }
      window.__PORTONI_PDF_READY__ = true;
    })();
  </script></body></html>`;
}

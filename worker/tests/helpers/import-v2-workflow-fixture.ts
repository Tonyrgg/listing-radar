import type { Page } from "playwright";
import type { ImportV2Checkpoint, ImportV2Failure, ImportV2Plan, SourceProperty } from "../../src/import-v2/model.js";
import type { ImportV2Store } from "../../src/import-v2/ports.js";
import type { AcquiredGraph } from "../../src/import-v2/source.js";
import type { CadastralOwner, CadastralProperty } from "../../src/types.js";

export const crmOrigin = "https://tecnocasa-group.my.site.com";
const root = "/CRMImmobiliareLightning/s";
const personId = "001000000000001AAA";
const escaped = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const field = (label: string, value: unknown, key = label) => `<div class="slds-form-element"><label>${label}<input data-field="${key}" value="${escaped(value)}"></label></div>`;
const detail = (label: string, value: unknown, edit = "") => `<div><div><label>${label}</label>${edit}</div><div class="slds-form-element__static">${escaped(value)}</div></div>`;
const pick = (label: string, value: string) => `<c-picklist><label>${label}</label><input role="textbox" value="${value}"></c-picklist>`;
const lookup = (label: string) => `<c-lookup><label>${label}</label><div class="slds-combobox_container"><input placeholder="Cerca" oninput="this.nextElementSibling.innerHTML='<li role=option data-item-id=a0Q3Y00000ecOpjUAE onclick=commitPlace(this)>BITONTO - BA</li>'"><ul></ul></div></c-lookup>`;
const lookupScript = `function commitPlace(option) { const box=option.parentElement.parentElement; const input=box.querySelector('input'); input.value='BITONTO'; input.readOnly=true; box.classList.add('slds-has-selection'); option.parentElement.innerHTML=''; }`;
const readForm = `Object.fromEntries([...document.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))`;

type Person = Record<string, string>;
type Property = { id: string; street: string; civic: string; catasto: Record<string, string>; activity: string | null };

/** All requests are fulfilled in memory. No live cookies, CRM or database. */
export class WorkflowUiFixture {
  person: Person | null = null;
  properties: Property[] = [];
  writes: string[] = [];
  searches: string[][] = [];
  failSearch = false;
  failPropertySearch = false;
  propertySearchDelay = 0;
  readonly errors: string[] = [];

  seedProperty(street: string, parcel: string) {
    this.properties.push({ id: `p-${parcel}`, street, civic: "10", catasto: {
      "Catasto Foglio": "38", "Catasto Particella": parcel, "Catasto Subalterno": "17", "Catasto Rendita": "400",
    }, activity: null });
  }

  private personForm(editing: boolean) {
    const p = this.person ?? {};
    return `<section role="dialog" id="form">
      ${["Nome", "Cognome", "Codice Fiscale", "Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono", "Email", "Email Secondaria"].map(label => field(label, p[label])).join("")}
      <c-input-date-time><label>Data Di Nascita</label><input data-field="Data Di Nascita" value="${p["Data Di Nascita"] ?? ""}"></c-input-date-time>
      ${lookup("Luogo Di Nascita")}<button onclick="savePerson()">Salva</button></section>
      <script>${lookupScript}
        async function persistPerson() {
          const values=${readForm}; values['Luogo Di Nascita']='BITONTO (BA)';
          await fetch('/_fixture/person', {method:'POST',body:JSON.stringify(values)});
          location.href='${root}/account/${personId}';
        }
        function savePerson() {
          if (${editing}) {
            document.body.insertAdjacentHTML('beforeend','<section role="dialog" id="merge"><h2>Riconcilia</h2><p>Tutti i campi sono stati riconciliati. Si può procedere al salvataggio</p><details><summary>Cliente</summary></details><details><summary>Recapiti ed Indirizzi</summary></details><button onclick="persistPerson()">Salva</button></section>');
          } else persistPerson();
        }
      </script>`;
  }

  private personPage() {
    return `${Object.entries(this.person ?? {}).map(([label, value]) => detail(label, value)).join("")}
      <button class="inline-edit-trigger" onclick="location.href='${root}/account/${personId}?edit=1'">Modifica</button>
      <article>Immobili/Notizie/Incarichi (${this.properties.length})
        ${this.properties.map(p => `<a href="${root}/immobile/${p.id}">IM - ${p.street} ${p.civic} - Rossi</a>`).join("")}
        <c-menu><button>Menu</button><a role="menuitem" href="${root}/account/${personId}?property=new"><span title="Nuovo">Nuovo</span></a></c-menu>
      </article>`;
  }

  private propertyForm() {
    return `<section role="dialog">${pick("Tipologia Immobile", "Appartamenti")}${pick("Sottotipologia Immobile", "3 locali")}
      ${field("Indirizzo", "")}${field("Civico", "")}${field("Interno", "")}${lookup("Comune")}
      <button onclick="position()">Avanti</button></section>
      <script>${lookupScript}
      let draft;
      function position() { draft=${readForm}; document.querySelector('section').innerHTML=
        '<h2>Immobile</h2><input type="radio" name="street" id="street_current-1" value="sister"><input type="radio" name="street" id="street_google-1" checked><c-picklist><label>Località</label><select><option></option><option>BITONTO</option></select></c-picklist><button onclick="saveProperty()">Salva</button>'; }
      async function saveProperty() {
        if (!document.querySelector('#street_current-1').checked || !document.querySelector('select').value) throw new Error('Posizionamento non confermato');
        const response=await fetch('/_fixture/property', {method:'POST',body:JSON.stringify(draft)});
        location.href='${root}/immobile/'+await response.text();
      }</script>`;
  }

  private propertyPage(p: Property) {
    const catastoLabels = ["Catasto Foglio", "Catasto Particella", "Catasto Subalterno", "Catasto Rendita"];
    return `<h1>IM - ${escaped(p.street)} ${p.civic} - Rossi</h1>
      <li class="slds-page-header__detail-block"><span class="slds-text-title">Indirizzo Completo Immobile</span><c-output-field>${escaped(p.street)} ${p.civic}, 70032 BITONTO (BA)</c-output-field></li>
      <div id="catasto">${catastoLabels.map(label => detail(label, p.catasto[label] ?? "", '<button class="inline-edit-trigger" onclick="editCatasto()">Modifica</button>')).join("")}</div>
      <div><div><label>Proprietario Predefinito</label></div><a href="${root}/account/${personId}">Rossi Mario</a></div>
      ${detail("Quota Proprietario", "100")}
      <article>Soggetti collegati (0)</article>
      <article id="activities">Attività e appuntamenti ${escaped(p.activity)}<button onclick="activityForm()">Nuovo</button></article>
      <script>
        const catasto=${JSON.stringify(p.catasto)};
        function editCatasto() {
          document.querySelector('#catasto').innerHTML=${JSON.stringify(catastoLabels.map(label => field(label, p.catasto[label] ?? "")).join(""))}+'<button onclick="saveCatasto()">Salva</button>';
        }
        async function saveCatasto() {
          await fetch('/_fixture/catasto/${p.id}', {method:'POST',body:JSON.stringify(${readForm})}); location.reload();
        }
        function activityForm() { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(`<section role="dialog"><c-input-field>Cliente<input value="Rossi Mario"></c-input-field><c-input-field>Correlato a<input value="IM - ${escaped(p.street)} ${p.civic}"></c-input-field><c-input-field>Modalità Contatto<input role="textbox" value="Contatto diretto"></c-input-field><c-input-field>Stato<input role="textbox" value="Eseguito"></c-input-field><c-input-field>Descrizione<textarea></textarea></c-input-field><button onclick="saveActivity()">Salva</button></section>`)}); }
        async function saveActivity() { const description=document.querySelector('textarea').value;
          await fetch('/_fixture/activity/${p.id}', {method:'POST',body:description}); document.querySelector('[role=dialog]').remove(); document.querySelector('#activities').append(description);
        }
      </script>`;
  }

  async install(page: Page) {
    page.on("pageerror", error => this.errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== crmOrigin) throw new Error(`Unexpected fixture origin: ${url.origin}`);
      const pathname = url.pathname;
      if (pathname.startsWith("/_fixture/")) {
        const body = route.request().postData() ?? "";
        let result = "ok";
        if (pathname === "/_fixture/person") {
          this.writes.push(this.person ? "person:update" : "person:create");
          this.person = JSON.parse(body);
        } else if (pathname === "/_fixture/property") {
          const data = JSON.parse(body);
          result = `created-${this.properties.length}`;
          this.properties.push({ id: result, street: data.Indirizzo, civic: data.Civico, catasto: {}, activity: null });
          this.writes.push("property:create");
        } else if (pathname.startsWith("/_fixture/catasto/")) {
          this.properties.find(p => p.id === pathname.split("/").at(-1))!.catasto = JSON.parse(body);
          this.writes.push("property:catasto");
        } else if (pathname.startsWith("/_fixture/activity/")) {
          this.properties.find(p => p.id === pathname.split("/").at(-1))!.activity = body;
          this.writes.push("activity:create");
        } else if (pathname === "/_fixture/search") {
          if (this.failPropertySearch) { await route.fulfill({ status: 503, body: "unavailable" }); return; }
          const values = JSON.parse(body) as string[];
          this.searches.push(values);
          if (this.propertySearchDelay) await new Promise(resolve => setTimeout(resolve, this.propertySearchDelay));
          const [street, sheet, parcel, sub] = values;
          const found = this.properties.filter(p => street ? p.street.toLowerCase().includes(street.toLowerCase())
            : p.catasto["Catasto Foglio"] === sheet && p.catasto["Catasto Particella"] === parcel && p.catasto["Catasto Subalterno"] === sub);
          result = found.length ? found.map(p => `<lightning-input c-queryviewer_queryviewer data-id="${p.id}"><input type="checkbox"></lightning-input>`).join("") : "<p>Nessun risultato</p>";
        } else throw new Error(`Unexpected fixture endpoint: ${pathname}`);
        await route.fulfill({ body: result });
        return;
      }
      let html = "";
      if (pathname.includes("/global-search/")) {
        const found = this.person?.["Codice Fiscale"] === decodeURIComponent(pathname.split("/").at(-1)!);
        html = `<h1>Risultati di ricerca</h1>${this.failSearch ? '<div role="alert">Errore durante la ricerca</div>'
          : found ? `<a data-refid="recordId" data-recordid="${personId}" href="${root}/account/${personId}">Rossi Mario</a>`
          : '<section>Clienti<span>0 risultati</span></section>'}`;
      } else if (url.searchParams.get("property") === "new") html = this.propertyForm();
      else if (url.searchParams.has("edit") || url.searchParams.has("create")) html = this.personForm(url.searchParams.has("edit"));
      else if (pathname.endsWith(`/account/${personId}`)) html = this.personPage();
      else if (pathname.includes("/immobile/Immobile__c")) html = `<input placeholder="--- Seleziona ---" value="Immobili residenziali">
        <button title="Filters" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#drawer').hidden=false">Filtri</button>
        <div id="drawer" hidden>${[9, 26, 27, 31].map(index => `<lightning-input c-queryviewerfilters_queryviewerfilters data-index="${index}"><input></lightning-input>`).join("")}
        <button onclick="apply()">Applica</button></div><div id="results"></div><script>
        async function apply() { const results=document.querySelector('#results'); results.setAttribute('aria-busy','true');
          const values=[9,26,27,31].map(i=>document.querySelector('[data-index="'+i+'"] input').value);
          const response=await fetch('/_fixture/search', {method:'POST',body:JSON.stringify(values)});
          results.innerHTML=await response.text();results.removeAttribute('aria-busy');
        }</script>`;
      else if (pathname.includes("/immobile/")) html = this.propertyPage(this.properties.find(p => p.id === pathname.split("/").at(-1))!);
      else html = `<input title="Search..." onkeydown="if(event.key==='Enter') location.href='${root}/global-search/'+this.value">
        <c-spotlight><button class="icon_container">Nuovo</button><ul><li class="element" onclick="location.href='${root}/account/Account?create=1'">Nominativo</li></ul></c-spotlight>`;
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><body>${html}</body>` });
    });
    await page.goto(`${crmOrigin}${root}/`);
  }
}

export class WorkflowMemoryStore implements ImportV2Store {
  checkpoints = new Map<string, ImportV2Checkpoint>();
  failures: ImportV2Failure[] = [];
  async loadOrCreate(plan: ImportV2Plan) {
    const key = plan.source.sourcePropertyId;
    const current = this.checkpoints.get(key);
    if (current) return structuredClone(current);
    const checkpoint: ImportV2Checkpoint = { itemId: key, jobId: plan.source.jobId, propertyId: key,
      stage: "queued", plan, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null,
      attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: new Date().toISOString() };
    await this.save(checkpoint);
    return checkpoint;
  }
  async save(checkpoint: ImportV2Checkpoint) { this.checkpoints.set(checkpoint.propertyId, structuredClone(checkpoint)); }
  async recordEvent() {}
  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { this.failures.push(failure); await this.save(checkpoint); }
  async pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { this.failures.push(failure); await this.save(checkpoint); }
  async quarantineSource(_source: SourceProperty, failure: ImportV2Failure) { this.failures.push(failure); }
}

export function addAcquired(graph: AcquiredGraph, jobId: string, property: CadastralProperty, owners: CadastralOwner[]) {
  const id = `${jobId}-${property.parcel}`;
  graph.properties.push({ id, job_id: jobId, municipality: property.municipality, sheet: property.sheet, parcel: property.parcel,
    subaltern: property.subaltern, cadastral_key: `${property.sheet}|${property.parcel}|${property.subaltern}`, address: property.address,
    census_zone: property.censusZone, category: property.category, class: property.class, consistency: property.consistency,
    cadastral_income: property.cadastralIncome, raw_payload: property.rawPayload, processing_status: "normalized", crm_record_id: null });
  for (const [index, owner] of owners.entries()) {
    const ownerId = `${id}-${index}`;
    graph.people.push({ id: ownerId, job_id: jobId, full_name: owner.fullName, tax_code: owner.taxCode, birth_place: owner.birthPlace,
      birth_province: owner.birthProvince, birth_date: owner.birthDate, right_type: owner.rightType, share_original: owner.shareOriginal,
      share_numerator: owner.shareNumerator, share_denominator: owner.shareDenominator, share_percentage: owner.sharePercentage,
      mobiles: ["3331111111"], landlines: [], emails: ["mario@example.it"], raw_payload: owner.rawPayload, processing_status: "normalized", crm_record_id: null });
    graph.ownerships.push({ id: `${id}-link-${index}`, property_id: id, person_id: ownerId, share_percentage: owner.sharePercentage, right_type: owner.rightType });
  }
}

export async function installSisterFixture(page: Page, street: string, parcel: string) {
  await page.route("**/*", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let html: string;
    if (pathname === "/owners") html = `<form name="SceltaIntestatiForm"><table class="listaIsp4">
      <tr><th></th><th>Nominativo o denominazione</th><th>Codice fiscale</th><th>Titolarita</th><th>Quota</th></tr>
      <tr><td><input name="intestatoSelezionato"></td><td>ROSSI MARIO nato a BITONTO (BA) il 01/01/1980</td><td>RSSMRA80A01A893P</td><td>Proprieta'</td><td>1/1</td></tr>
      </table></form><form name="SceltaVisuraImmSoggForm" action="/results"><input name="indietro" type="submit" value="Indietro"></form>`;
    else if (pathname === "/results") html = `<fieldset><legend>Dati della ricerca</legend>Comune: BITONTO Codice: A893 Indirizzo: ${street} Numeri civici</fieldset>
      <form name="SceltaVisuraImmSoggForm" action="/owners"><table class="listaIsp4">
      <tr><th></th><th>Foglio</th><th>Particella</th><th>Sub</th><th>Indirizzo</th><th>Zona cens</th><th>Categoria</th><th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
      <tr><td><input name="visImmSel" type="radio" value="1"></td><td>38</td><td>${parcel}</td><td>17</td><td>${street} n. 10</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>400,00</td></tr>
      </table><input name="intestati" type="submit" value="Intestati"></form><form name="SceltaIndirizzoForm" action="/addresses"><input type="submit" value="Indietro"></form>`;
    else html = `<form name="SceltaIndirizzoForm" action="/results"><select name="indirizzoSel"><option value="test##${street}">${street}</option></select>
      <input name="numCivicoDal"><input name="numCivicoAl"><input name="ricerca" type="submit" value="Ricerca"></form>`;
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><body>${html}</body>` });
  });
  await page.goto("https://sister3.agenziaentrate.gov.it/addresses");
}

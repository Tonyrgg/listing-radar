import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { ActivityWriteRequest } from "../src/import-v2/ports.js";
import type { ImportV2Plan } from "../src/import-v2/model.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
afterAll(async () => { await browser?.close(); });
const propertyId = "a01000000000001AAA";
const clientId='001000000000001AAA';
const task = (id: number) => ({ Id: `00T${String(id).padStart(12, "0")}AAA`, WhatId: propertyId,AccountId:clientId,CreatedDate:id===1?'2026-10-01T10:00:00Z':new Date().toISOString(),Description: "Non vende", Status: "Eseguito" });
const plan: ImportV2Plan = { version: 2, fingerprint: "operation-test", source: { sourcePropertyId: "source", jobId: "job", municipality: "BITONTO", fullAddress: "VIA TEST n. 1", cadastral: { urbanSection: null, sheet: "1", parcel: "1", parcelDenomination: null, subaltern: "1", income: null }, category: "A/2", propertyClass: null, consistency: null, owners: [], activity: { enabled: true, description: "Non vende", contactMode: "Telefonata", status: "Eseguito" } } };
const request = (operationId = "operation"): ActivityWriteRequest => {
  const result: ActivityWriteRequest = { state: { operationId, preparedAt: new Date().toISOString(), baselineIds: [], submittedAt: null }, persist: async state => { result.state = structuredClone(state); } }; return result;
};
async function fixture(page: Page,formClientId=clientId,savedClientId=clientId) {
  const records = [task(1)]; let saves = 0, broken = false;
  await page.route("https://tecnocasa-group.my.site.com/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/tasks") return broken ? route.fulfill({ status: 503, body: "Unavailable" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(records) });
    if (pathname === "/save") { saves++; records.push({...task(records.length + 1),AccountId:savedClientId}); return route.fulfill({ contentType: "application/json", body: JSON.stringify({actions:[{state:'SUCCESS',returnValue:records.at(-1)}]}) }); }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti</h2><button id="new" onclick="document.querySelector('#form').hidden=false">Nuovo</button></article>
      <section role="dialog" id="form" hidden><h2>Attività</h2>
      <c-input-field>Cliente<input value="Mario Rossi"><span data-recordid="${formClientId}"></span></c-input-field><c-input-field>Correlato a<input value="IM - Via Test 1"></c-input-field>
      <c-input-field>Modalità Contatto<input role="textbox" data-kind="contact" value="Telefonata" readonly></c-input-field><c-input-field>Stato<input role="textbox" data-kind="status" value="Da eseguire" readonly></c-input-field>
      <c-input-field>Descrizione<textarea></textarea></c-input-field><div id="options"></div><button id="save">Salva</button></section>
      <script>fetch('/tasks');
      document.querySelectorAll('[data-kind]').forEach(input=>input.onclick=()=>{document.querySelector('#options').innerHTML=(input.dataset.kind==='contact'?['Telefonata','Contatto diretto']:['Da eseguire','Eseguito']).map(v=>'<div role="option" data-kind="'+input.dataset.kind+'">'+v+'</div>').join('')});
      document.querySelector('#options').onclick=e=>{const option=e.target.closest('[role="option"]');if(option){document.querySelector('input[data-kind="'+option.dataset.kind+'"]').value=option.textContent;document.querySelector('#options').innerHTML=''}};
      document.querySelector('#save').onclick=async()=>{await fetch('/save',{method:'POST',body:JSON.stringify({WhatId:'${propertyId}'})});document.querySelector('#form').hidden=true};</script>` });
  });
  await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
  return { records, saves: () => saves, breakRead: (value: boolean) => { broken = value; } };
}

it('conserva l’ID restituito da Salva e verifica cliente, immobile, stato e data di inserimento',async()=>{
 const page=await browser.newPage();try{
  const state=await fixture(page),write=request();write.client={id:clientId,name:'Rossi Mario',taxCode:'RSSMRA80A01A662A',phones:[]};
  write.history={propertyId,clientId,baselineIds:[task(1).Id.slice(0,15)],checkedAt:new Date().toISOString()};
  const result=await new TecnocloudUiV2Port(page).ensureActivity(propertyId,plan,write);
  expect(result).toMatchObject({outcome:'created',activityId:task(2).Id,clientId,propertyId,descriptionVerified:true,statusVerified:true});
  expect(result.activityDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(write.state.savedActivityId).toBe(task(2).Id);expect(state.saves()).toBe(1);
 }finally{await page.close();}
},15000);
it('non salva se il campo Cliente non contiene l’identità CRM prevista',async()=>{
 const page=await browser.newPage();try{
  const state=await fixture(page,'001000000000002AAA'),write=request();write.client={id:clientId,name:'Rossi Mario',taxCode:'RSSMRA80A01A662A',phones:[]};
  await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId,plan,write)).rejects.toThrow('cliente dell’attività');expect(state.saves()).toBe(0);
 }finally{await page.close();}
},15000);
it('non completa un’attività riletta su un altro cliente e non ripete il salvataggio',async()=>{
 const page=await browser.newPage();try{
  const state=await fixture(page,clientId,'001000000000002AAA'),write=request();write.client={id:clientId,name:'Rossi Mario',taxCode:'RSSMRA80A01A662A',phones:[]};
  await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId,plan,write)).rejects.toThrow();
  await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId,plan,write)).rejects.toThrow();expect(state.saves()).toBe(1);
 }finally{await page.close();}
},20000);

it("un Task storico identico non salta la nuova attività; ripetere la stessa operazione non duplica", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page), write = request();
    const submissions = new Set<string>(), port = () => new TecnocloudUiV2Port(page, false, { submittedActivities: submissions });
    const first = await port().ensureActivity(propertyId, plan, write);
    expect(first).toMatchObject({ outcome: "created", activityId: task(2).Id, descriptionVerified: true, statusVerified: true });
    expect(write.state).toMatchObject({ baselineIds: [task(1).Id.slice(0, 15)], submittedAt: expect.any(String) });
    expect(await port().ensureActivity(propertyId, plan, write)).toMatchObject({ outcome: "existing", activityId: task(2).Id });
    expect(state.saves()).toBe(1);
    expect(await port().ensureActivity(propertyId, plan, request("next-import"))).toMatchObject({ outcome: "created", activityId: task(3).Id });
    expect(state.saves()).toBe(2);
  } finally { await page.close(); }
}, 30000);

it("la risposta persa dopo Salva è recuperata da un port nuovo con l'intento persistito", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page), write = request();
    const persist = write.persist;
    write.persist = async intent => { await persist(intent); state.breakRead(true); };
    await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId, plan, write)).rejects.toThrow();
    expect(state.saves()).toBe(1); expect(write.state.submittedAt).toBeTruthy();
    state.breakRead(false);
    expect(await new TecnocloudUiV2Port(page).ensureActivity(propertyId, plan, write)).toMatchObject({ outcome: "existing", activityId: task(2).Id });
    expect(state.saves()).toBe(1);
  } finally { await page.close(); }
}, 30000);

it("un vecchio Task non risolve un invio incerto; nessun secondo click su Salva", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page), write = request();
    write.state.baselineIds = [task(1).Id.slice(0, 15)]; write.state.submittedAt = new Date().toISOString();
    await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId, plan, write)).rejects.toThrow("già inviata");
    expect(state.saves()).toBe(0);
  } finally { await page.close(); }
}, 10000);

it("se non può salvare il confine su disco, non invia l'attività al CRM", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page), write = request(); write.persist = async () => { throw new Error("disk write failed"); };
    await expect(new TecnocloudUiV2Port(page).ensureActivity(propertyId, plan, write)).rejects.toThrow("disk write failed");
    expect(state.saves()).toBe(0);
  } finally { await page.close(); }
}, 10000);

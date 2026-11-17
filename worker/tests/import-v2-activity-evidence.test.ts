import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
afterAll(async () => { await browser?.close(); });
const propertyId = "a01000000000001AAA";
const task = (overrides: Record<string, unknown> = {}) => ({ attributes: { type: "Task" }, Id: "00T000000000001AAA", WhatId: propertyId, Description: "Non vende", Status: "Eseguito", ...overrides });
type Reader = { readActivityEvidence(id: string, description: string, status: string): Promise<{ found: boolean; descriptionVerified: boolean; statusVerified: boolean }> };
describe("Prove di attività Killer già esistente", () => {
 it('opens Show All for a saved completed Task hidden from the preview',async()=>{
  const page=await browser.newPage();const id='00T000000000002AAA',client='001000000000001AAA';try{
   await page.route('https://tecnocasa-group.my.site.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/all-data')return route.fulfill({contentType:'application/json',body:JSON.stringify({...task(),Id:id,Cliente__c:client,CreatedDate:new Date().toISOString()})});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti (0+)</h2><a onclick="document.querySelector('article').remove();document.querySelector('[role=dialog]').style.display='block';fetch('/all-data')">Visualizza tutto</a></article><div role="dialog" style="display:none"><h2>Attività e appuntamenti (1)</h2><a href="/task/${id}">Non vende</a></div>`});
   });
   await page.goto('https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/');
   const port=new TecnocloudUiV2Port(page) as unknown as {readActivityEvidence:(id:string,d:string,s:string,scope:unknown)=>Promise<{found:boolean;activityId:string}>};
   expect(await port.readActivityEvidence(propertyId,'Non vende','Eseguito',{excludedIds:new Set(),submitted:true,activityId:id,clientId:client})).toMatchObject({found:true,activityId:id});
  }finally{await page.close();}
 });
 it('combines fields from the same persisted Task split across responses',async()=>{
  const page=await browser.newPage();const id='00T000000000002AAA',client='001000000000001AAA';try{
   await page.route('https://tecnocasa-group.my.site.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/part-a')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,WhatId:propertyId,Description:'Non vende'})});
    if(path==='/part-b')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,Cliente__c:client,Status:'Completed',CreatedDate:new Date().toISOString()})});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti (1)</h2></article><script>fetch("/part-a");fetch("/part-b")</script>'});
   });
   await page.goto('https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/');
   const port=new TecnocloudUiV2Port(page) as unknown as {readActivityEvidence:(id:string,d:string,s:string,scope:unknown)=>Promise<{found:boolean;activityId:string}>};
   expect(await port.readActivityEvidence(propertyId,'Non vende','Eseguito',{excludedIds:new Set(),submitted:true,activityId:id,clientId:client})).toMatchObject({found:true,activityId:id});
  }finally{await page.close();}
 });
  it.each([
    ["opzioni dei menu", { picklistValues: { description: ["Non vende", "Ci abita", "Segreteria"], status: ["Da eseguire", "Eseguito"] } }, false],
    ["attività di un altro immobile", task({ WhatId: "a01000000000002AAA" }), false],
    ["descrizione e stato appartenenti a record diversi", [task({ Status: "Da eseguire" }), task({ Id: "00T000000000002AAA", Description: "Ci abita" })], false],
    ["record senza relazione verificabile", { description: "Non vende", status: "Eseguito" }, false],
    ["attività vera correlata all'immobile", { actions: [{ returnValue: [task()] }] }, true],
  ] as const)("distingue %s", async (_label, payload, expected) => {
    const page = await browser.newPage();
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => {
        if (new URL(route.request().url()).pathname === "/activity-data") return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti (0)</h2><button>Nuovo</button></article><script>fetch("/activity-data")</script>' });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const result = await (new TecnocloudUiV2Port(page) as unknown as Reader).readActivityEvidence(propertyId, "Non vende", "Eseguito");
      expect(result.found).toBe(expected);
      if (expected) expect(result).toMatchObject({ descriptionVerified: true, statusVerified: true, activityId: "00T000000000001AAA" });
    } finally { await page.close(); }
  });
  it("non combina descrizione e stato di due righe visibili diverse", async () => {
    const page = await browser.newPage();
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti (2)</h2><ul><li>Descrizione Non vende. Stato Da eseguire</li><li>Descrizione Ci abita. Stato Eseguito</li></ul></article>' }));
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      expect((await (new TecnocloudUiV2Port(page) as unknown as Reader).readActivityEvidence(propertyId, "Non vende", "Eseguito")).found).toBe(false);
    } finally { await page.close(); }
  });
  it("una lettura attività fallita non autorizza una nuova creazione", async () => {
    const page = await browser.newPage();
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => {
        if (new URL(route.request().url()).pathname === "/activity-data") return route.fulfill({ status: 500, body: "Service unavailable" });
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<p>Indirizzo Completo Immobile</p><article><h2>Attività e appuntamenti (0)</h2><button>Nuovo</button></article><script>fetch("/activity-data")</script>' });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      await expect((new TecnocloudUiV2Port(page) as unknown as Reader).readActivityEvidence(propertyId, "Non vende", "Eseguito")).rejects.toThrow("non ha completato");
    } finally { await page.close(); }
  });
});

import{beforeAll,afterAll,describe,it,expect}from'vitest';
import{chromium,type Browser}from'playwright';
import{readCrmActivityHistory}from'../src/import-v2/activity-history-reader.js';
const origin='https://tecnocasa-group.my.site.com',property='a0V000000000001AAA',client='001000000000001AAA',id='00T000000000001AAA';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});afterAll(async()=>{await browser?.close();});
const options={propertyId:property,clientId:client,propertyUrl:origin+'/property',clientUrl:origin+'/client',assertSession:async()=>{}};
describe('complete CRM activity history',{timeout:15000},()=>{
 it('opens the live zero-plus preview and verifies the exact empty list',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<article>Numero attività di ricerca</article><article id="preview"><h2>Attività e appuntamenti (0+)</h2><a onclick="document.getElementById('preview').remove();setTimeout(()=>document.querySelector('[role=dialog]').style.display='block',400)">Visualizza tutto</a></article><div role="dialog" style="display:none"><h2>Attività e appuntamenti (0)</h2></div>`}));
   expect(await readCrmActivityHistory(page,options)).toMatchObject({records:[],propertyComplete:true,clientComplete:true});
  }finally{await page.close();}
 });
 it('reads Show All when it opens a dialog rather than an article',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',route=>new URL(route.request().url()).pathname==='/task-data'
    ?route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,WhatId:property,AccountId:client,Status:'Completed',Description:'Test',CreatedDate:'2026-11-10T09:00:00Z'})})
    :route.fulfill({contentType:'text/html; charset=utf-8',body:`<article><h2>Attività e appuntamenti (1)</h2><button onclick="document.querySelector('article').remove();document.querySelector('[role=dialog]').style.display='block'">Visualizza tutto</button></article><div role="dialog" style="display:none"><h2>Attività e appuntamenti (1)</h2><a href="/task/${id}">Task</a></div><script>fetch('/task-data')</script>`}));
   expect(await readCrmActivityHistory(page,options)).toMatchObject({propertyComplete:true,clientComplete:true});
  }finally{await page.close();}
 });
 it('reads an explicit empty list without inventing activities',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<article><h2>Attività e appuntamenti (0)</h2><p>Nessuna attività</p></article>'}));
   expect(await readCrmActivityHistory(page,options)).toMatchObject({records:[],propertyComplete:true,clientComplete:true});
  }finally{await page.close();}
 });
 it('follows the exact Task link to retrieve fields missing from a related-list response',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/partial')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,Description:'Non vende'})});
    if(url.pathname==='/full')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,WhatId:property,AccountId:client,Description:'Non vende',Status:'Completed',ActivityDate:'2026-11-10',CreatedDate:'2026-11-10T09:00:00Z'})});
    if(url.pathname.includes(id))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Attività</h1><script>fetch("/full")</script>'});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<article><h2>Attività e appuntamenti (1)</h2><a href="/task/${id}">Non vende</a></article><script>fetch('/partial')</script>`});
   });
   const result=await readCrmActivityHistory(page,options);
   expect(result).toMatchObject({propertyComplete:true,clientComplete:true,records:[{id,propertyId:property,clientId:client,status:'Completed',activityDate:'2026-11-10'}]});
  }finally{await page.close();}
 });
 it('does not call a truncated list complete or infer a missing customer from null standard fields',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',async route=>{
    if(new URL(route.request().url()).pathname==='/data')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,WhatId:property,AccountId:null,WhoId:null,Status:'Completed',ActivityDate:'2026-11-10'})});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<article><h2>Attività e appuntamenti (3)</h2><span data-recordid="${id}">Attività</span></article><script>fetch('/data')</script>`});
   });
   const result=await readCrmActivityHistory(page,options);expect(result.propertyComplete).toBe(false);expect(result.clientComplete).toBe(false);
  }finally{await page.close();}
 });
 it('reads explicit relation links and creation date on a Task detail page when the API omits them',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/partial')return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,Description:'Non vende'})});
    if(url.pathname.includes(id))return route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Attività</h1><div><label>Correlato a</label><a href="/immobile/${property}">Immobile</a></div><div><label>Cliente</label><a href="/account/${client}">Rossi Mario</a></div><div><label>Stato</label><p>Eseguito</p></div><div><label>Data creazione</label><p>10/11/2026, 09:30</p></div><div><label>Descrizione</label><p>Non vende</p></div>`});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<article><h2>Attività e appuntamenti (1)</h2><a href="/task/${id}">Non vende</a></article><script>fetch('/partial')</script>`});
   });
   expect(await readCrmActivityHistory(page,options)).toMatchObject({propertyComplete:true,clientComplete:true,records:[{id,propertyId:property,clientId:client,status:'Eseguito',createdAt:'2026-11-10'}]});
  }finally{await page.close();}
 });
 it('does not turn a failed history request into an empty list',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',async route=>new URL(route.request().url()).pathname==='/aura'?route.fulfill({status:503,body:'Unavailable'}):route.fulfill({contentType:'text/html; charset=utf-8',body:'<article><h2>Attività e appuntamenti (0)</h2></article><script>fetch("/aura")</script>'}));
   expect(await readCrmActivityHistory(page,options)).toMatchObject({propertyComplete:false,clientComplete:false});
  }finally{await page.close();}
 });
 it('waits for an in-flight request rather than trusting the initial zero placeholder',async()=>{
  const page=await browser.newPage();try{
   await page.route(origin+'/**',async route=>{
    if(new URL(route.request().url()).pathname==='/delayed'){
      await new Promise(resolve=>setTimeout(resolve,800));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({Id:id,WhatId:property,AccountId:client,Status:'Completed',CreatedDate:'2026-11-10T09:00:00Z'})});
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<article><h2>Attività e appuntamenti (0)</h2></article><script>fetch('/delayed').then(r=>r.json()).then(()=>{document.querySelector('h2').textContent='Attività e appuntamenti (1)'})</script>`});
   });
   expect(await readCrmActivityHistory(page,options)).toMatchObject({propertyComplete:true,clientComplete:true,records:[{id}]});
  }finally{await page.close();}
 });
});

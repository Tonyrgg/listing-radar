import {chromium,type Browser,type Page} from 'playwright';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {TecnocloudUiV2Port} from '../src/import-v2/tecnocloud-ui-port.js';
const root='https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s';
const cf='TESTCF0000000000',record='001000000000001AAA';
const searchInput=`<input title="Search..." onkeydown="if(event.key==='Enter')location.href='${root}/global-search/'+encodeURIComponent(this.dataset.query||'OLD')" onkeyup="if(event.key!=='Enter'){document.querySelector('.slds-spinner').hidden=false;clearTimeout(window.timer);window.timer=setTimeout(()=>{this.dataset.query=this.value;document.querySelector('.slds-spinner').hidden=true},700)}"><div class="slds-spinner" hidden>Caricamento</div>`;
describe('Ricerca CF con barra già pronta',()=>{
 let browser:Browser,page:Page;
 beforeEach(async()=>{browser=await chromium.launch({headless:true,channel:'chrome'});page=await browser.newPage();});
 afterEach(async()=>{await browser?.close();});
 it.each(['','/nome-collaudo'])('riusa la scheda letta%s, attende il debounce e invia il CF completo senza ricaricare la lista',async suffix=>{
  let lists=0,submitted='';
  await page.route('https://tecnocasa-group.my.site.com/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/account/Account'))lists++;
   if(path.includes('/global-search/')){submitted=decodeURIComponent(path.split('/global-search/')[1]!);await route.fulfill({contentType:'text/html',body:'<h1>Risultati di ricerca</h1><div>Clienti 0 risultati</div>'});}
   else await route.fulfill({contentType:'text/html',body:searchInput});
  });
  await page.goto(`${root}/account/${record}${suffix}`);
  expect(await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).toEqual([]);
  expect(submitted).toBe(cf);expect(lists).toBe(0);
 });
 it('non usa lo zero della ricerca precedente come conferma per la stessa query',async()=>{
  let lists=0,searches=0;
  await page.route('https://tecnocasa-group.my.site.com/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/account/Account')){lists++;await route.fulfill({contentType:'text/html',body:searchInput});}
   else {searches++;await route.fulfill({contentType:'text/html',body:searchInput+'<h1>Risultati di ricerca</h1><div>Clienti 0 risultati</div>'});}
  });
  await page.goto(`${root}/global-search/${cf}`);
  expect(await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).toEqual([]);
  expect(lists).toBe(1);expect(searches).toBe(2);
 });
 it('attende il nominativo tardivo anche se inizialmente appare Clienti 0',async()=>{
  await page.route('https://tecnocasa-group.my.site.com/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/late-client')){await new Promise(resolve=>setTimeout(resolve,1400));await route.fulfill({json:{ready:true}});}
   else if(path.includes('/global-search/'))await route.fulfill({contentType:'text/html',body:`<h1>Risultati di ricerca</h1><section>Clienti 0 risultati</section><script>fetch('/late-client').then(r=>r.json()).then(()=>document.querySelector('section').innerHTML='<a href="${root}/account/person-late">Cliente</a>')</script>`});
   else if(path.endsWith('/account/person-late'))await route.fulfill({contentType:'text/html',body:[['Codice Fiscale',cf],['Nome','Nome'],['Cognome','Collaudo']].map(([label,value])=>`<div><div><label>${label}</label></div><div class="slds-form-element__static"><span class="slds-grow">${value}</span></div></div>`).join('')});
   else await route.fulfill({contentType:'text/html',body:searchInput});
  });
  await page.goto(`${root}/account/${record}`);
  const rows=await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf);
  expect(rows).toEqual([expect.objectContaining({id:'person-late',taxCode:cf})]);
 });
});

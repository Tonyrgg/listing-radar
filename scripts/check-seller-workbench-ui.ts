/** Local browser/SQL harness. Synthetic data and stubbed Next routing/actions only. */
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { reviewSchema } from '../src/lib/seller-intake/model';
import { ingestSellerSubmission } from '../src/lib/seller-intake/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {normalizeTonySignal} from '../src/lib/tonybook/signals';
async function main() {
const output = process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if (!output) throw Error('Pass --output=<local screenshots directory>');
await mkdir(output,{recursive:true});
const db=new PGlite(), owner='10000000-0000-4000-8000-000000000001';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
  grant usage on schema auth to authenticated; create table auth.users(id uuid primary key);
  insert into auth.users values('${owner}');
  create function public.assert_public_news_candidate(p_id uuid) returns void language sql as $$select null::void$$;
  create table public.public_record_news_feedback(candidate_id uuid,user_id uuid,status text,source_signature text);
  insert into public_record_news_feedback values ('30000000-0000-4000-8000-000000000003','${owner}','INTERESTING','synthetic');
  create function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;`);
await db.exec(await readFile('supabase/migrations/0046_seller_workbench.sql','utf8'));
await db.exec('create table public.properties(id uuid primary key)');
for(const file of ['0047_seller_provenance.sql','0048_seller_outcomes.sql','0049_tonybook_verifications.sql','0050_seller_mock_delivery.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
const client={rpc:async(_name:string,a:Record<string,unknown>)=>{
  try {const r=await db.query<{data:unknown}>('select receive_seller_submission($1,$2,$3,$4::jsonb) as data',[a.p_owner,a.p_external,a.p_signature,JSON.stringify(a.p_submission)]);return {data:r.rows[0].data,error:null};}
  catch(error){return {data:null,error};}
}} as unknown as SupabaseClient;
await ingestSellerSubmission(client,owner,{externalId:'browser-test',formVersion:'seller_v1',name:'Persona fittizia — collaudo locale',phone:'+390000000000',answers:{situation:'considering_sale',role:'owner',locality:'Bitonto',propertyType:'apartment',timing:'undecided'},callbackRequested:true,whatsappOptIn:true,privacyVersion:'LOCAL_TEST_ONLY',attribution:{source:'local_test'}});
await db.exec('set role authenticated');
await db.query("select plan_seller_verification('news:30000000-0000-4000-8000-000000000003','synthetic','Cantiere sintetico da verificare',$1::jsonb)",[JSON.stringify({unknown:'Civico e relazione con il mercato ancora da verificare. Dati interamente fittizi.'})]);
for(const [id,state] of [['S007','ACTIVE'],['S008','REJECTED']]){
  const s=normalizeTonySignal({id,state,fact:'Segnale sintetico '+id+' da verificare',unknowns:'Autore e disponibilità non confermati.',reference:{module:'TONYBOOK',sourceType:'local_registry',sourceId:id,sourceUrl:'https://example.test/'+id,observedAt:'2026-10-24',publishedAt:null,evidenceSignature:'a'.repeat(64)}});
  await db.query('select register_tonybook_signal($1,$2,$3,$4,$5,$6)',[s.id,s.state,JSON.stringify(s.reference),s.fact,s.unknowns,s.signature]);
}
const bundled=await build({write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),sourcefile:'seller-qa.tsx',loader:'tsx',contents:`
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{SellerWorkbench}from'./src/components/seller-workbench';
import{TonyBookSignals}from'./src/components/tonybook-signals';
import{SidebarNav}from'./src/components/sidebar-nav';
function App(){const[state,setState]=useState(null);useEffect(()=>{const read=()=>{const q=new URLSearchParams(location.search);if(location.pathname.endsWith('/segnali'))q.set('tony','1');return fetch('/state?'+q).then(r=>r.json()).then(setState)};read();window.addEventListener('refresh',read);return()=>window.removeEventListener('refresh',read)},[]);return state?<div className="p-4 md:p-6"><SidebarNav/><div className="mt-8">{state.tony?<TonyBookSignals {...state}/>:<SellerWorkbench {...state}/>}</div></div>:<p>Caricamento…</p>}
createRoot(document.getElementById('root')).render(<App/>);`},plugins:[{name:'next-fixtures',setup(b){
  b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'next-fixture'}));
  b.onLoad({filter:/.*/,namespace:'next-fixture'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path==='next/link'?`import React from 'react';export default function Link(p){return <a {...p}/>}`:`export function usePathname(){return '/richieste'};export function useRouter(){return{refresh(){window.dispatchEvent(new Event('refresh'))}}}`}));
  b.onResolve({filter:/^@\/lib\/actions\/seller-workbench$/},()=>({path:'actions',namespace:'seller-actions'}));
  b.onLoad({filter:/.*/,namespace:'seller-actions'},()=>({contents:`export async function updateSellerCase(v){return fetch('/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)}).then(r=>r.json())}`}));
  b.onResolve({filter:/^@\/lib\/actions\/tonybook$/},()=>({path:'tony-actions',namespace:'tony-actions'}));
  b.onLoad({filter:/.*/,namespace:'tony-actions'},()=>({contents:`export async function selectTonyBookVerification(f){const r=await fetch('/plan-tony',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.get('id'),signature:f.get('signature'),confirmed:f.get('confirmed')==='yes'})});if(!r.ok)throw Error('Verifica non salvata');location.assign('/richieste')}`}));
}}]});
const cssFiles=(await readdir('.next/static/chunks')).filter(f=>f.endsWith('.css'));
if (!cssFiles.length) throw Error('Run npm run build before browser QA');
const css=(await Promise.all(cssFiles.map(f=>readFile(path.join('.next/static/chunks',f),'utf8')))).join('\n');
let paginationMode=false;
const server=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url??'/', 'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].contents);return;}
  if(url.pathname==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(url.pathname.startsWith('/_next/static/')){const f=path.resolve('.next/static',url.pathname.slice('/_next/static/'.length));if(!f.startsWith(path.resolve('.next/static')+path.sep)){res.writeHead(404).end();return;}res.end(await readFile(f));return;}
  if(url.pathname==='/state'){
    if(url.searchParams.get('tony')==='1'){
      const r=await db.query('select id,state,reference,fact,unknowns,signature from tonybook_signals order by id');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tony:true,signals:r.rows,page:1,total:r.rows.length}));return;
    }
    const closed=url.searchParams.get('closed')==='1';
    const page=Math.max(1,Number(url.searchParams.get('page'))||1),pageSize=50;
    const r=await db.query(`select c.*,coalesce((select jsonb_agg(h.*) from seller_case_history h where h.case_id=c.id),'[]') as seller_case_history,
      coalesce((select jsonb_agg(o.*) from seller_delivery_outbox o where o.case_id=c.id),'[]') as seller_delivery_outbox
      from seller_cases c where (c.status in ('CLOSED','MANDATE','DO_NOT_CONTACT'))=$1 and coalesce(c.submission->>'qaPagination','false')=$2 order by c.next_action_at nulls last,c.id limit $3 offset $4`,[closed,String(paginationMode),paginationMode?pageSize:100,paginationMode?(page-1)*pageSize:0]);
    const total=paginationMode?151:r.rows.length;
    const m=await db.query<{metrics:unknown}>('select seller_workbench_metrics() as metrics');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:r.rows,metrics:m.rows[0].metrics,closed,pagination:paginationMode?{page,pageSize,total,hasNext:page*pageSize<total}:undefined}));return;
  }
  if(url.pathname==='/plan-tony'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;const v=JSON.parse(body);
    const r=await db.query('select plan_tonybook_verification($1,$2,$3)',[v.id,v.signature,v.confirmed]);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r.rows));return;
  }
  if(url.pathname==='/review'&&req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)throw Error('Too large');}
    const parsed=reviewSchema.safeParse(JSON.parse(body));res.setHeader('Content-Type','application/json');
    if(!parsed.success){res.end(JSON.stringify({error:parsed.error.issues[0].message}));return;}
    const v=parsed.data;
    try{await db.query('select review_seller_case($1,$2,$3,$4,$5,$6)',[v.id,v.revision,v.status,v.nextAction,v.nextActionAt,v.note]);res.end('{}');}
    catch{res.end(JSON.stringify({error:'Salvataggio non riuscito.'}));}return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="it"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
})().catch(()=>{res.writeHead(500).end('Local QA error');});});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
const browser=await chromium.launch({headless:true});const results:unknown[]=[];
try{
  for(const width of [390,1024,1600]){
    const page=await browser.newPage({viewport:{width,height:900},timezoneId:'Europe/Rome'});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/richieste`,{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Richieste e verifiche',exact:true}).waitFor();
    if(await page.locator('details[open]').count())throw Error('Details should be collapsed');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Overflow at ${width}`);
    await page.screenshot({path:path.join(output,`queue-${width}.png`),fullPage:true});
    const inbound=page.locator('article').filter({hasText:'Persona fittizia'});
    await inbound.getByText('Registra un esito',{exact:true}).click();
    if(!await inbound.getByLabel('Quando (orario del dispositivo)').inputValue())throw Error('Existing next action lost');
    await inbound.getByLabel('Esito / stato').selectOption('TO_CALL');
    await inbound.getByLabel('Prossimo passo').selectOption('NONE');
    await inbound.getByLabel('Che cosa hai verificato o concordato?').fill('Esito di collaudo, nessun contatto reale.');
    await inbound.getByRole('button',{name:'Registra esito e prossimo passo'}).click();
    await inbound.getByRole('status').getByText('Indica il prossimo passo e quando svolgerlo.').waitFor();
    await inbound.getByLabel('Prossimo passo').selectOption('CALL');
    await inbound.getByLabel('Quando (orario del dispositivo)').fill('2026-10-26T10:30');
    await page.screenshot({path:path.join(output,`review-${width}.png`),fullPage:true});
    await inbound.getByRole('button',{name:'Registra esito e prossimo passo'}).click();
    await inbound.locator('span').filter({hasText:/^Da chiamare$/}).waitFor();
    await page.reload({waitUntil:'networkidle'});
    await page.locator('article').filter({hasText:'Persona fittizia'}).locator('span').filter({hasText:/^Da chiamare$/}).waitFor();
    const verification=page.locator('article').filter({hasText:'Cantiere sintetico'});
    await verification.getByText('Registra un esito',{exact:true}).click();
    if(await verification.getByLabel('Esito / stato').locator('option[value="TO_CALL"]').count())throw Error('Verification offered a commercial contact');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Expanded overflow at ${width}`);
    if(errors.length)throw Error(errors.join('\n'));
    results.push({width,overflow:false,persistedAfterReload:true,verificationSeparated:true});await page.close();
  }
  const closedPage=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Europe/Rome'});
  await closedPage.goto(`http://127.0.0.1:${port}/richieste`,{waitUntil:'networkidle'});
  const contact=closedPage.locator('article').filter({hasText:'Persona fittizia'});
  await contact.getByText('Registra un esito',{exact:true}).click();
  await contact.getByLabel('Esito / stato').selectOption('DO_NOT_CONTACT');
  await contact.getByLabel('Che cosa hai verificato o concordato?').fill('Opposizione sintetica: collaudo della soppressione.');
  await contact.getByRole('button',{name:'Registra esito e prossimo passo'}).click();
  await contact.waitFor({state:'detached'});
  await closedPage.getByRole('link',{name:'Chiuse',exact:true}).click();
  const suppressed=closedPage.locator('article').filter({hasText:'Persona fittizia'});
  await suppressed.locator('span').filter({hasText:/^Non contattare$/}).waitFor();
  await suppressed.getByText('Registra un esito',{exact:true}).click();
  if(await suppressed.getByLabel('Esito / stato').locator('option').count()!==1)throw Error('Suppressed case can be reopened in UI');
  await closedPage.screenshot({path:path.join(output,'suppressed-390.png'),fullPage:true});
  const deliveries=await db.query<{status:string}>('select status from seller_delivery_outbox');
  if(deliveries.rows.some(r=>r.status!=='CANCELLED'))throw Error('Suppressed deliveries left active');
  results.push({suppressionPersists:true,pendingDeliveriesCancelled:true});await closedPage.close();
  for(const width of [390,1024,1600]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto(`http://127.0.0.1:${port}/richieste/segnali`,{waitUntil:'networkidle'});
    const active=page.locator('article').filter({hasText:'S007'}),rejected=page.locator('article').filter({hasText:'S008'});
    if(await rejected.getByRole('button').count())throw Error('Rejected signal can be planned in UI');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`TonyBook overflow ${width}`);
    await page.screenshot({path:path.join(output,`tonybook-${width}.png`),fullPage:true});
    const selectionResponse=page.waitForResponse(r=>r.url().endsWith('/plan-tony'));
    await active.getByRole('button',{name:'Pianifica una verifica'}).click();
    if((await selectionResponse).status()!==200)throw Error('TonyBook SQL selection failed');
    await page.waitForURL('**/richieste');await page.locator('article').filter({hasText:'Segnale sintetico S007'}).waitFor();
    if((await db.query("select o.id from seller_delivery_outbox o join seller_cases c on c.id=o.case_id where c.kind='VERIFICATION'")).rows.length)throw Error('Document verification generated delivery');
    results.push({tonybookWidth:width,explicitSelection:true,rejectedUnavailable:true,noContactOrDelivery:true});await page.close();
  }
  await db.exec('reset role'); // Fixture preparation only; application requests keep authenticated/RLS.
  await db.query(`insert into seller_cases(owner_id,kind,external_id,signature,title,submission,next_action,next_action_at)
    select $1,'VERIFICATION','qa-page-'||g,'synthetic','Pratica di prova '||g,'{"qaPagination":true,"unknown":"Prova di navigazione senza dati reali"}'::jsonb,'VERIFY',now() from generate_series(1,151) g`,[owner]);
  await db.exec('set role authenticated');
  paginationMode=true;
  for(const width of [390,1024,1600]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto(`http://127.0.0.1:${port}/richieste`,{waitUntil:'networkidle'});
    const ids=()=>page.locator('article').evaluateAll(nodes=>nodes.map(n=>n.id));
    const first=await ids();if(first.length!==50)throw Error('Pagination size mismatch');
    await page.screenshot({path:path.join(output,`pagination-${width}.png`)});
    const seen=new Set(first);
    while(await page.getByRole('link',{name:'Successive',exact:true}).count()){
      const next=page.getByRole('link',{name:'Successive',exact:true});await next.focus();await next.press('Enter');await page.waitForLoadState('networkidle');
      for(const id of await ids()){if(seen.has(id))throw Error('Duplicate row across pages');seen.add(id);}
      if(width!==390)break;
    }
    if(width===390&&seen.size!==151)throw Error('Not all cases reached');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Pagination overflow ${width}`);
    if(width!==390){await page.getByRole('link',{name:'Precedenti',exact:true}).click();await page.waitForLoadState('networkidle');if(JSON.stringify(await ids())!==JSON.stringify(first))throw Error('Unstable previous page');}
    results.push({paginationWidth:width,uniqueRowsReached:seen.size,stableNavigation:true});await page.close();
  }
  await writeFile(path.join(output,'browser-results.json'),JSON.stringify({synthetic:true,transport:'Local fixture for Next routing and actions; real components and PostgreSQL migration',results},null,2));
  console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();}
}
main().catch(error=>{console.error(error);process.exit(1);});

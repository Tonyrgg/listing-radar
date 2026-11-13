import type {Page,Response,Request} from 'playwright';
import {activityTaskFragments,mergeTaskFragment,taskSnapshot,type TaskFragment} from './activity-records.js';
import type {CrmActivityHistory} from './model.js';
import {sameCrmRecordId} from '../core/crm-record-id.js';
import {ImportV2Error} from './errors.js';
import {readActivityDetailDom} from './activity-detail-reader.js';
import {activityCoverage} from './activity-policy.js';
import {activityResponseText} from './activity-response.js';

const taskIds=(text:string)=>[...new Set([...text.matchAll(/\b00T[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g)].map(m=>m[0]))];
const emptyList=/nessun[aeo]?\s+(?:attivit[aà]|element[oi]|record)|non (?:sono presenti|ci sono) attivit[aà]/i;
const headerCount=/Attivit[aà](?: e appuntamenti)?\s*\((\d+)\)/i;
type Options={propertyId:string;clientId:string;propertyUrl:string;clientUrl:string;assertSession:()=>Promise<void>;stopOnPropertyCoverage?:boolean};

/** No guessed API endpoint and no writes. Read the actual related list and,
 * when its Task payload omits fields, follow the Task's own visible link. */
export async function readCrmActivityHistory(page:Page,options:Options):Promise<CrmActivityHistory>{
  const fragments=new Map<string,TaskFragment>(),tasks=new Set<Promise<void>>(),pending=new Set<Request>();let failed=false;
  const origin=new URL(options.propertyUrl).origin;
  const relevant=(request:Request)=>['xhr','fetch'].includes(request.resourceType())&&new URL(request.url()).origin===origin;
  const started=(request:Request)=>{if(relevant(request))pending.add(request);};
  const finished=(request:Request)=>pending.delete(request);
  const requestFailed=(request:Request)=>{if(relevant(request)){failed=true;pending.delete(request);}};
  const inspect=(response:Response)=>{
    if(!relevant(response.request()))return;
    if(!response.ok()){failed=true;return;}
    let job:Promise<void>;job=activityResponseText(response).then(body=>{for(const row of activityTaskFragments(body,options.clientId))mergeTaskFragment(fragments,row);})
      .catch(()=>{failed=true;}).finally(()=>tasks.delete(job));tasks.add(job);
  };
  page.on('response',inspect);
  page.on('request',started);page.on('requestfinished',finished);page.on('requestfailed',requestFailed);
  async function settled(){
    for(let count=0,stable=0;count<48;count++){
      await options.assertSession();
      const busy=await page.locator('lightning-spinner:visible,.slds-spinner:visible,[role="progressbar"]:visible').count();
      stable=!busy&&!tasks.size&&!pending.size?stable+1:0;if(stable>=3)return;
      await page.waitForTimeout(250);
    }
    throw new ImportV2Error('Lo storico attività Cloud non ha terminato il caricamento. Nessun nuovo inserimento.','verification_failed');
  }
  async function list(url:string,parentId:string,kind:'property'|'client'){
    failed=false;
    await page.goto(url,{waitUntil:'commit',timeout:20_000});
    const cards=page.locator('article:visible').filter({hasText:/Attivit[aà](?: e appuntamenti)?/i});
    let card=cards.filter({hasNot:cards});
    await card.waitFor({state:'visible',timeout:10_000});
    await settled();
    let text=await card.innerText();
    let declared=headerCount.exec(text)?.[1];
    const showAll=card.getByRole('link',{name:/^Visualizza tutt[oi]$/i}).or(card.getByRole('button',{name:/^Visualizza tutt[oi]$/i}));
    if(await showAll.count()===1&&declared!==undefined&&Number(declared)>taskIds(await card.innerHTML()).length){
      await showAll.click();await settled();
      const modal=page.locator('[role="dialog"]:visible').filter({hasText:/Attivit[aà](?: e appuntamenti)?/i});
      if(await modal.count()===1)card=modal;
      else {
        const fresh=page.locator('article:visible').filter({hasText:/Attivit[aà](?: e appuntamenti)?/i});card=fresh.filter({hasNot:fresh});
      }
      if(await card.count()!==1)return false;
      text=await card.innerText();declared=headerCount.exec(text)?.[1]??declared;
    }
    const listed=new Set<string>(),events=new Set<string>(),links=new Map<string,string>();let exhausted=false;
    for(let pageIndex=0;pageIndex<50;pageIndex++){
      const priorCount=listed.size+events.size;
      const html=await card.innerHTML();for(const id of taskIds(html))listed.add(id.slice(0,15));
      for(const match of html.matchAll(/\b00U[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g))events.add(match[0].slice(0,15));
      if(pageIndex>0&&listed.size+events.size===priorCount)break;
      const anchors=await card.locator('a[href]').evaluateAll(nodes=>nodes.map(a=>({href:(a as HTMLAnchorElement).href,text:a.outerHTML})));
      for(const anchor of anchors)for(const id of taskIds(anchor.text)){
        const target=new URL(anchor.href,page.url());
        if(target.origin===new URL(page.url()).origin&&target.href.includes(id))links.set(id.slice(0,15),target.href);
      }
      const next=card.getByRole('button',{name:/^(?:Avanti|Successiv[oa])$/i});
      if(await next.count()!==1||await next.isDisabled()){exhausted=true;break;}
      await next.click();await settled();
    }
    // Tasks supplied by the scoped response also count, but never records
    // belonging to another property/client seen elsewhere on the page.
    for(const [id,row]of fragments)if(kind==='property'?row.propertyId&&sameCrmRecordId(row.propertyId,parentId):row.clientId&&sameCrmRecordId(row.clientId,parentId))listed.add(id);
    const completeList=exhausted&&(declared!==undefined?listed.size+events.size===Number(declared):listed.size===0&&events.size===0&&emptyList.test(text));
    for(const id of listed){
      if(taskSnapshot(fragments.get(id)??{id},kind==='property'))continue;
      const href=links.get(id);if(!href)continue;
      // No partial fields from a different Task can complete this one.
      await page.goto(href,{waitUntil:'commit',timeout:20_000});await settled();
      const detail=await readActivityDetailDom(page,id);if(detail)mergeTaskFragment(fragments,detail);
    }
    return !failed&&completeList&&[...listed].every(id=>Boolean(taskSnapshot(fragments.get(id)??{id},kind==='property')));
  }
  const rows=()=>[...fragments.values()].map(row=>taskSnapshot(row,true)).filter((r):r is NonNullable<typeof r>=>Boolean(r));
  async function safeList(url:string,parentId:string,kind:'property'|'client'){
    try{return await list(url,parentId,kind);}
    catch(error){await options.assertSession();if(error instanceof ImportV2Error&&error.options.global)throw error;return false;}
  }
  try{
    const propertyComplete=await safeList(options.propertyUrl,options.propertyId,'property');
    if(options.stopOnPropertyCoverage&&activityCoverage({records:rows(),propertyComplete,clientComplete:false,checkedAt:new Date().toISOString()},options.propertyId,options.clientId,new Date())){
      return{records:rows(),propertyComplete,clientComplete:false,checkedAt:new Date().toISOString()};
    }
    const clientComplete=await safeList(options.clientUrl,options.clientId,'client');
    return {records:rows(),propertyComplete,clientComplete,checkedAt:new Date().toISOString()};
  }catch(error){
    await options.assertSession();
    if(error instanceof ImportV2Error)throw error;
    throw new ImportV2Error('Lo storico delle attività non è leggibile completamente. Dati conservati; attività da verificare senza inserimenti ripetuti.','verification_failed');
  }finally{page.off('response',inspect);page.off('request',started);page.off('requestfinished',finished);page.off('requestfailed',requestFailed);await Promise.allSettled(tasks);}
}

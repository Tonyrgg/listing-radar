import type {Page,Response,Request} from 'playwright';
import {activityTaskFragments,mergeTaskFragment,taskSnapshot,type TaskFragment} from './activity-records.js';
import type {CrmActivityHistory} from './model.js';
import {sameCrmRecordId} from '../core/crm-record-id.js';
import {ImportV2Error} from './errors.js';
import {readActivityDetailDom,readActivityFields} from './activity-detail-reader.js';
import {activityCoverage,activityDay,romeDay} from './activity-policy.js';
import {activityResponseText} from './activity-response.js';

const taskIds=(text:string)=>[...new Set([...text.matchAll(/\b00T[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g)].map(m=>m[0]))];
const emptyList=/nessun[aeo]?\s+(?:attivit[aà]|element[oi]|record)|non (?:sono presenti|ci sono) attivit[aà]/i;
const headerCount=/Attivit[aà](?: e appuntamenti)?\s*\((\d+)(\+)?\)/i;
const historyHeading=/^\s*Attivit[aà](?: e appuntamenti)?\s*$/i;
type Options={propertyId:string;clientId:string;propertyUrl:string;clientUrl:string;assertSession:()=>Promise<void>;stopOnPropertyCoverage?:boolean};

/** Read the related list and open the exact Task when the summary omits fields. */
export async function readCrmActivityHistory(page:Page,options:Options):Promise<CrmActivityHistory>{
  const issues:NonNullable<CrmActivityHistory['issues']>=[];
  const fragments=new Map<string,TaskFragment>(),tasks=new Set<Promise<void>>(),pending=new Set<Request>();let failed=false;
  const rows=()=>[...fragments.values()].map(row=>taskSnapshot(row,true)).filter((r):r is NonNullable<typeof r>=>Boolean(r));
  const hasCoverage = () => {
    if (!options.stopOnPropertyCoverage) return false;
    const current = new Date();
    return Boolean(activityCoverage(
      { records: rows(), propertyComplete: false, clientComplete: false, checkedAt: current.toISOString() },
      options.propertyId, options.clientId, current,
    ));
  };
  const origin=new URL(options.propertyUrl).origin;
  const relevant=(request:Request)=>['xhr','fetch'].includes(request.resourceType())&&new URL(request.url()).origin===origin;
  const started=(request:Request)=>{if(relevant(request))pending.add(request);};
  const finished=(request:Request)=>pending.delete(request);
  const requestFailed=(request:Request)=>{if(pending.delete(request))failed=true;};
  const inspect=(response:Response)=>{
    if(!relevant(response.request())||!pending.has(response.request()))return;
    if(!response.ok()){failed=true;return;}
    let job:Promise<void>;job=activityResponseText(response).then(body=>{for(const row of activityTaskFragments(body,options.clientId))mergeTaskFragment(fragments,row);})
      .catch(()=>{failed=true;}).finally(()=>tasks.delete(job));tasks.add(job);
  };
  page.on('response',inspect);
  page.on('request',started);page.on('requestfinished',finished);page.on('requestfailed',requestFailed);
  async function settled(allowCoverage = false){
    for(let count=0,stable=0;count<48;count++){
      await options.assertSession();
      if (allowCoverage && hasCoverage()) return;
      const busy=await page.locator('lightning-spinner:visible,.slds-spinner:visible,[role="progressbar"]:visible').count();
      stable=!busy&&!tasks.size&&!pending.size?stable+1:0;if(stable>=3)return;
      await page.waitForTimeout(250);
    }
    throw new ImportV2Error('Lo storico attività Cloud non ha terminato il caricamento. Nessun nuovo inserimento.','verification_failed');
  }
  async function list(url:string,parentId:string,kind:'property'|'client'){
    pending.clear();
    failed=false;
    await page.goto(url,{waitUntil:'commit',timeout:20_000});
    const cards=page.locator('c-activity-summary:visible,article:visible').filter({hasText:headerCount})
      .or(page.locator('c-activity-summary:visible,article:visible').filter({
        has:page.getByText(historyHeading,{exact:true}),hasText:emptyList,
      }));
    let card=cards.filter({hasNot:cards});
    await card.waitFor({state:'visible',timeout:10_000});
    await settled(true);
    if (hasCoverage()) return false;
    let text=await card.innerText();
    let declared=headerCount.exec(text)?.[1];
    let truncated=Boolean(headerCount.exec(text)?.[2]);
    const showAll=card.getByText(/^Visualizza tutt[oi]$/i).filter({visible:true});
    const previewIds=taskIds(await card.innerHTML());
    if(await showAll.count()===1&&(truncated||declared===undefined||Number(declared)>previewIds.length
      ||previewIds.some(id=>!taskSnapshot(fragments.get(id.slice(0,15))??{id},kind==='property')))){
      await showAll.click();await settled();
      const lwcList=page.locator('c-lwc-modal').filter({has:page.locator('.slds-modal__container:visible')}).filter({hasText:headerCount});
      const dialog=page.locator('[role="dialog"]:visible').filter({hasText:headerCount});
      await lwcList.or(dialog).first().waitFor({state:'attached',timeout:5000}).catch(()=>undefined);
      await settled();
      const modal=await lwcList.count()?lwcList:dialog;
      if(await modal.count()===1)card=modal;
      else {
        card=cards.filter({hasNot:cards});
      }
      if(await card.count()!==1)return false;
      text=await card.innerText();declared=headerCount.exec(text)?.[1]??declared;truncated=Boolean(headerCount.exec(text)?.[2]);
    }
    const listed=new Set<string>(),events=new Set<string>(),links=new Map<string,string>();let exhausted=false;
    const day=romeDay(new Date());
    const cutoff=kind==='property'?day.slice(0,7)+'-01':day;
    const outsideWindow=(row:TaskFragment|undefined)=>{
      if(!row||row.conflicted)return false;
      const created=activityDay({createdAt:row.createdAt??null,activityDate:null});
      return created!==null&&created<cutoff;
    };
    const resolved=(id:string)=>outsideWindow(fragments.get(id))||Boolean(taskSnapshot(fragments.get(id)??{id},kind==='property'));
    for(let pageIndex=0;pageIndex<50;pageIndex++){
      const priorCount=listed.size+events.size;
      const html=await card.innerHTML();for(const id of taskIds(html))listed.add(id.slice(0,15));
      // The full list can render inside an LWC shadow root. Its Task controls
      // have a real record ID but intentionally have no href.
      const taskControls=card.locator('a[data-objectname="Task"][data-recordid][data-modalview="true"]:visible');
      const ids=await taskControls.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-recordid')??''));
      for(const id of ids)if(taskIds(id).includes(id))listed.add(id.slice(0,15));
      for(const match of html.matchAll(/\b00U[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g))events.add(match[0].slice(0,15));
      if(pageIndex>0&&listed.size+events.size===priorCount)break;
      const anchors=await card.locator('a[href]').evaluateAll(nodes=>nodes.map(a=>({href:(a as HTMLAnchorElement).href,text:a.outerHTML})));
      for(const anchor of anchors)for(const id of taskIds(anchor.text)){
        const target=new URL(anchor.href,page.url());
        if(target.origin===new URL(page.url()).origin&&target.href.includes(id))links.set(id.slice(0,15),target.href);
      }
      for(const id of new Set(ids)){
        const key=id.slice(0,15);
        if(!listed.has(key)||resolved(key))continue;
        const control=taskControls.and(card.locator(`[data-recordid="${id}"]`));
        if(await control.count()!==1)continue;
        const close=page.getByRole('button',{name:'Chiudi',exact:true});
        const modalCandidates=page.locator('c-lwc-modal,[role="dialog"],.slds-modal').filter({has:close});
        const modals=modalCandidates.filter({hasNot:modalCandidates});
        const before=await modals.elementHandles();
        const fresh=[];
        try {
          await control.click({timeout:5000});
          await settled();
          if(hasCoverage())return false;
          for(let index=0,count=await modals.count();index<count;index++){
            const modal=modals.nth(index);
            if(await modal.evaluate((node,previous)=>!previous.includes(node),before))fresh.push(modal);
          }
        } finally { await Promise.allSettled(before.map(handle=>handle.dispose())); }
        // Read only the dialog created by opening this exact Task. The list
        // and unrelated dialogs can contain other record IDs and statuses.
        if(fresh.length!==1)return false;
        const modal=fresh[0]!;
        mergeTaskFragment(fragments,await readActivityFields(modal,id));
        if(hasCoverage())return false;
        await modal.getByRole('button',{name:'Chiudi',exact:true}).click({timeout:5000});
        await settled();
      }
      const next=card.getByRole('button',{name:/^(?:Avanti|Successiv[oa])$/i});
      if(await next.count()!==1||await next.isDisabled()){exhausted=true;break;}
      await next.click();await settled();
    }
    // Tasks supplied by the scoped response also count, but never records
    // belonging to another property/client seen elsewhere on the page.
    for(const [id,row]of fragments)if(kind==='property'?row.propertyId&&sameCrmRecordId(row.propertyId,parentId):row.clientId&&sameCrmRecordId(row.clientId,parentId))listed.add(id);
    const completeList=!truncated&&exhausted&&(declared!==undefined?listed.size+events.size===Number(declared):listed.size===0&&events.size===0&&emptyList.test(text));
    for(const id of listed){
      if(resolved(id))continue;
      const href=links.get(id);if(!href)continue;
      // No partial fields from a different Task can complete this one.
      await page.goto(href,{waitUntil:'commit',timeout:20_000});await settled();
      const detail=await readActivityDetailDom(page,id);if(detail)mergeTaskFragment(fragments,detail);
    }
    const completeRecords=[...listed].every(resolved);
    if(!completeList)issues.push({scope:kind,missing:['elenco_completo']});
    for(const id of listed){const r=fragments.get(id);if(resolved(id))continue;issues.push({scope:kind,taskId:id,missing:[...(!activityDay({createdAt:r?.createdAt??null,activityDate:null})?['data_creazione']:[]),...(r?.propertyId===undefined?['immobile_collegato']:[]),...(kind==='client'&&r?.clientId===undefined?['cliente_collegato']:[]),...(!r?.status?['stato']:[]),...(r?.conflicted?['valori_discordanti']:[])]});}
    console.info(JSON.stringify({action:'activity-history',kind,declared,truncated,listed:listed.size,events:events.size,exhausted,failed,completeList,completeRecords}));
    return !failed&&completeList&&completeRecords;
  }
  async function safeList(url:string,parentId:string,kind:'property'|'client'){
    try{return await list(url,parentId,kind);}
    catch(error){await options.assertSession();if(error instanceof ImportV2Error&&error.options.global)throw error;issues.push({scope:kind,missing:['elenco_completo']});console.info(JSON.stringify({action:'activity-history',kind,error:error instanceof Error?error.message:String(error)}));return false;}
  }
  try{
    const propertyComplete=await safeList(options.propertyUrl,options.propertyId,'property');
    if(hasCoverage()){
      return{records:rows(),propertyComplete,clientComplete:false,checkedAt:new Date().toISOString(),issues};
    }
    const clientComplete=await safeList(options.clientUrl,options.clientId,'client');
    return {records:rows(),propertyComplete,clientComplete,checkedAt:new Date().toISOString(),issues};
  }catch(error){
    await options.assertSession();
    if(error instanceof ImportV2Error)throw error;
    throw new ImportV2Error('Lo storico delle attività non è leggibile completamente. Dati conservati; attività da verificare senza inserimenti ripetuti.','verification_failed');
  }finally{page.off('response',inspect);page.off('request',started);page.off('requestfinished',finished);page.off('requestfailed',requestFailed);await Promise.allSettled(tasks);}
}

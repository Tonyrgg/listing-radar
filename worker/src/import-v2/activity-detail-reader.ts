import type{Locator,Page}from'playwright';
import type{TaskFragment}from'./activity-records.js';

const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s*:/-]+/g,' ').trim().toUpperCase();
const fields:Record<string,keyof TaskFragment>={
 'CORRELATO A':'propertyId','IMMOBILE':'propertyId','CLIENTE':'clientId','SOGGETTO':'clientId',
 'STATO':'status','DESCRIZIONE':'description','DATA CREAZIONE':'createdAt','DATA DI CREAZIONE':'createdAt','CREATO IL':'createdAt','DATA INSERIMENTO':'createdAt',
 'DATA ORA CREAZIONE':'createdAt','DATA E ORA CREAZIONE':'createdAt','CREATO DA':'createdAt',
};
/** DOM fallback is allowed only on the Task's own record URL. Relations must
 * be explicit record links inside the corresponding single labelled field. */
export async function readActivityDetailDom(page:Page,id:string):Promise<TaskFragment|null>{
 const url=new URL(page.url());
 const values=[...url.pathname.split('/'),...url.searchParams.values()];
 if(!values.some(value=>/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value)&&value.slice(0,15)===id.slice(0,15)))return null;
 return readActivityFields(page,id);
}

/** The caller must identify the new modal opened by the exact Task control. */
export async function readActivityFields(scope:Locator|Page,id:string):Promise<TaskFragment>{
 const result:TaskFragment={id};
 const labelSelector='label,dt,.slds-form-element__label,.test-id__field-label,[data-field-label]';
 const labels=scope.locator(labelSelector).filter({visible:true});
 for(let index=0;index<await labels.count();index++){
  const label=labels.nth(index),labelText=(await label.getAttribute('data-field-label'))||await label.innerText(),key=fields[normalized(labelText)];if(!key)continue;
  let container=label.locator('xpath=..');
  for(let depth=0;depth<3;depth++){
   if(await container.locator(labelSelector).count()>1)break;
   const text=(await container.innerText()).replace(labelText,'').trim();
   if(text||depth===2){
    if(key==='propertyId'||key==='clientId'){
     const values=await container.locator('a[href],[data-recordid],[data-record-id]').evaluateAll(nodes=>nodes.flatMap(node=>[node.getAttribute('href')??'',node.getAttribute('data-recordid')??'',node.getAttribute('data-record-id')??'']));
     const ids=[...new Set(values.flatMap(value=>[...value.matchAll(/\b[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g)].map(m=>m[0])).filter(value=>value.slice(0,15)!==id.slice(0,15)))];
     if(ids.length===1)result[key]=ids[0]!;else if(/^[-—]+$/.test(text))result[key]=null;
    }else if(key==='createdAt'){
     const iso=text.match(/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/)?.[0];
     const local=text.match(/\b(\d{2})\/(\d{2})\/(\d{4})(?:\s|,|$)/);
     if(iso)result.createdAt=iso;else if(local)result.createdAt=`${local[3]}-${local[2]}-${local[1]}`;
    }else if(key==='description'||key==='status')result[key]=text;
    break;
   }
   container=container.locator('xpath=..');
  }
 }
 return result;
}

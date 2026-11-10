import type{Page}from'playwright';
import type{TaskFragment}from'./activity-records.js';

const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s*:]+/g,' ').trim().toUpperCase();
const fields:Record<string,keyof TaskFragment>={
 'CORRELATO A':'propertyId','IMMOBILE':'propertyId','CLIENTE':'clientId','SOGGETTO':'clientId',
 'STATO':'status','DESCRIZIONE':'description','DATA CREAZIONE':'createdAt','DATA DI CREAZIONE':'createdAt','CREATO IL':'createdAt','DATA INSERIMENTO':'createdAt',
};
/** DOM fallback is allowed only on the Task's own record URL. Relations must
 * be explicit record links inside the corresponding single labelled field. */
export async function readActivityDetailDom(page:Page,id:string):Promise<TaskFragment|null>{
 if(!new URL(page.url()).pathname.includes(id.slice(0,15)))return null;
 const result:TaskFragment={id};
 const labels=page.locator('label:visible,dt:visible');
 for(let index=0;index<await labels.count();index++){
  const label=labels.nth(index),labelText=await label.innerText(),key=fields[normalized(labelText)];if(!key)continue;
  let container=label.locator('xpath=..');
  for(let depth=0;depth<3;depth++){
   if(await container.locator('label,dt').count()>1)break;
   const text=(await container.innerText()).replace(labelText,'').trim();
   if(text||depth===2){
    if(key==='propertyId'||key==='clientId'){
     const values=await container.locator('a[href],[data-recordid],[data-record-id]').evaluateAll(nodes=>nodes.flatMap(node=>[node.getAttribute('href')??'',node.getAttribute('data-recordid')??'',node.getAttribute('data-record-id')??'']));
     const ids=[...new Set(values.flatMap(value=>[...value.matchAll(/\b[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g)].map(m=>m[0])).filter(value=>value.slice(0,15)!==id.slice(0,15)))];
     if(ids.length===1)result[key]=ids[0]!;else if(!text||/^[-—]+$/.test(text))result[key]=null;
    }else if(key==='createdAt'){
     const iso=text.match(/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/)?.[0];
     const local=text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|,|$)/);
     if(iso)result.createdAt=iso;else if(local)result.createdAt=`${local[3]}-${local[2]}-${local[1]}`;
    }else if(key==='description'||key==='status')result[key]=text;
    break;
   }
   container=container.locator('xpath=..');
  }
 }
 return result;
}

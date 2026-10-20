/** Explicit bounded re-reading of EXISTING records. No inventory/source expansion. */
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseBuildingPracticeCsv,normalizeBuildingPracticeRows} from '../src/lib/property-lifecycle/buildings/practices';
import {DEFAULT_BUILDING_PRACTICE_SOURCE_KEY as KEY,DEFAULT_BUILDING_PRACTICE_SOURCE_URL as URL2024} from '../src/lib/property-lifecycle/buildings/importer';
import {PRACTICES_2025} from '../src/lib/property-lifecycle/buildings/public-record-policy';
import {AlboHttp,parseAlboDetail} from '../src/lib/property-lifecycle/buildings/albo';
import {allFactRecords,readSemanticProjections,projectPropertyFacts,type SemanticProjection} from '../src/lib/property-lifecycle/buildings/facts-projection';
import {NEWS_POLICY,romeToday} from '../src/lib/property-lifecycle/buildings/news-triage';
import {newsSourceContext} from '../src/lib/property-lifecycle/buildings/news-source-context';
import {cheapFacts,deepCandidate,extractPropertyFacts,FACT_POLICY,type FactRecord} from '../src/lib/property-lifecycle/buildings/property-facts';
import {extractKnownPdfFacts} from '../src/lib/property-lifecycle/buildings/facts-pdf';
const args=process.argv.slice(2),apply=args.includes('--apply'),primary=args.includes('--primary'),resume=args.includes('--resume');
const value=(name:string)=>args.find(a=>a.startsWith(name+'='))?.split('=').slice(1).join('=');
const out=value('--output')??'.runtime/property-facts/plan.json',limit=Math.min(FACT_POLICY.deepLimit,Math.max(0,Number(value('--albo-limit')??FACT_POLICY.deepLimit)));
const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,project=new URL(url).hostname.split('.')[0];
if(apply&&value('--confirm-project')!==project)throw Error('Explicit target confirmation required');
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
type SourceRecord=FactRecord&{source_record_key:string;document_urls:string[];territorial_references:unknown[]};
async function main(){
 await mkdir(out.replace(/[\\/][^\\/]+$/,''),{recursive:true});
 const records=await allFactRecords(db) as SourceRecord[],previous=await readSemanticProjections(db),at=new Date().toISOString();
 const current=(r:SourceRecord)=>!!r.record_date&&r.record_date>=NEWS_POLICY.start&&r.record_date<=romeToday(Date.now());
 let rows=records.map(record=>({recordId:record.id,inputHash:record.content_hash,projection:previous.get(record.id)?.hash===record.content_hash?previous.get(record.id)!.projection:{version:FACT_POLICY.version,events:cheapFacts(record,at),candidate:deepCandidate(record),status:'REVIEW'} as SemanticProjection}));
 const diagnostics:Array<Record<string,unknown>>=[];
 if(resume){const previous=JSON.parse(await readFile(out,'utf8'));const old=new Map(previous.rows.map((r:typeof rows[number])=>[r.recordId,r]));rows=rows.map(r=>{const p=old.get(r.recordId) as typeof r|undefined;if(p?.inputHash!==r.inputHash)return r;p.projection.events=[...r.projection.events,...p.projection.events.filter(e=>e.evidence_location.field!=='practice_type')];return p;});diagnostics.push(...previous.diagnostics);}
 const byId=new Map(rows.map(r=>[r.recordId,r]));
 const save=async()=>writeFile(out,JSON.stringify({version:FACT_POLICY.version,preparedAt:at,documents:records.length,rows,diagnostics},null,2));
 if(primary){
  for(const [key,sourceUrl] of [[KEY,URL2024],[PRACTICES_2025.key,PRACTICES_2025.url]]){
   if(resume&&!args.includes('--refresh-csv')&&diagnostics.some(d=>d.source===key&&d.status==='OK'))continue;
   if(args.includes('--refresh-csv'))for(const record of records.filter(r=>r.source_key===key))byId.get(record.id)!.projection.events=cheapFacts(record,at);
   const response=await fetch(sourceUrl,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Known CSV HTTP ${response.status}`);
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>25*1024*1024)throw Error('Known CSV too large');
   const body=new TextDecoder().decode(bytes),hash=createHash('sha256').update(bytes).digest('hex'),raw=parseBuildingPracticeCsv(body);
   const existing=new Map(records.filter(r=>r.source_key===key).map(r=>[r.source_record_key,r]));let matched=0;
   for(let index=0;index<raw.length;index++){
    const normalized=normalizeBuildingPracticeRows([raw[index]]).records[0];if(!normalized)continue;
    const record=existing.get(normalized.sourceRecordKey);if(!record||!current(record))continue;matched++;
    const row=byId.get(record.id)!;row.projection.primaryReviewed=true;
    for(const field of ['Oggetto','Oggetto Fascicolo','Tipo Pratica']){
     const text=Object.entries(raw[index]).find(([k])=>k.replace(/\s/g,'').toLowerCase()===field.replace(/\s/g,'').toLowerCase())?.[1];if(!text)continue;
     const events=extractPropertyFacts(record.id,{text,field,sourceUrl,sourceHash:hash,observedAt:at,row:index+2},record.record_date);
     for(const event of events)if(!row.projection.events.some(e=>e.event_type===event.event_type))row.projection.events.push(event);
    }
   }
   diagnostics.push({source:key,status:'OK',rows:raw.length,matchedRows:matched,sha256:hash,rawRetained:false});await save();
  }
  const http=new AlboHttp(),candidates=records.filter(r=>r.source_key==='comune-bitonto-albo'&&current(r)).sort((a,b)=>deepCandidate(b).priority-deepCandidate(a).priority||(b.record_date??'').localeCompare(a.record_date??'')).slice(0,limit);
  for(const record of candidates){
   const row=byId.get(record.id)!;if(resume&&!args.includes('--refresh-albo')&&row.projection.primaryReviewed)continue;
   try{const html=await http.get(record.source_url!),detail=parseAlboDetail(html,record.source_record_key);
    const events=extractPropertyFacts(record.id,{text:detail.subject,field:'albo.subject',sourceUrl:record.source_url!,sourceHash:createHash('sha256').update(html).digest('hex'),observedAt:at,territorialScopeVerified:record.territorial_references?.length>0},detail.documentDate??detail.actDate??record.record_date);
    row.projection.events=[...row.projection.events,...events.filter(e=>!row.projection.events.some(v=>v.id===e.id))];row.projection.newsContext=newsSourceContext(detail.subject,record.source_url!,createHash('sha256').update(html).digest('hex'),at);row.projection.primaryReviewed=true;row.projection.status=row.projection.events.length?'EXTRACTED':'NO_SUPPORTED_FACT';
    diagnostics.push({recordId:record.id,status:'OK',events:events.length,documentUrls:detail.documents});
   }catch(e){diagnostics.push({recordId:record.id,status:'REVIEW',reason:String(e)});row.projection.status='REVIEW';}
   await save();
  }
 }
 const pdfLimit=Math.min(FACT_POLICY.pdfLimit,Math.max(0,Number(value('--pdf-limit')??0)));
 const pdfCandidates=records.filter(r=>current(r)&&byId.get(r.id)!.projection.candidate.priority>=70&&!byId.get(r.id)!.projection.deep)
  .map(r=>({record:r,urls:(diagnostics.find(d=>d.recordId===r.id&&d.status==='OK')?.documentUrls??r.document_urls??[]) as string[]})).filter(r=>r.urls.length).slice(0,pdfLimit);
 for(const {record,urls} of pdfCandidates){const row=byId.get(record.id)!;try{const result=await extractKnownPdfFacts(record.id,urls[0],record.record_date);
  row.projection.events=row.projection.events.filter(e=>e.evidence_location.field!=='pdf.text'||e.evidence_location.source_url!==urls[0]);
  for(const event of result.events)if(!row.projection.events.some(e=>e.event_type===event.event_type))row.projection.events.push(event);
  row.projection.deep={status:result.totalPages>result.pagesExamined?'PARTIAL_REVIEW':result.events.length?'EXTRACTED':'NO_SUPPORTED_FACT',url:urls[0]};
  diagnostics.push({recordId:record.id,deep:true,status:'OK',sha256:result.sha256,pagesExamined:result.pagesExamined,totalPages:result.totalPages,events:result.events.length});
 }catch(e){row.projection.deep={status:'REVIEW',url:urls[0],reason:String(e)};diagnostics.push({recordId:record.id,deep:true,status:'REVIEW',reason:String(e)});}await save();}
 for(const r of rows){r.projection.events=r.projection.events.slice(0,FACT_POLICY.maxEvents);if(r.projection.events.length)r.projection.status='EXTRACTED';else if(r.projection.primaryReviewed)r.projection.status='NO_SUPPORTED_FACT';}
 await save();
 if(apply)await projectPropertyFacts(db,true,new Map(rows.map(r=>[r.recordId,r.projection])));
 const types:Record<string,number>={};for(const r of rows)for(const e of r.projection.events)types[e.event_type]=(types[e.event_type]??0)+1;
 console.log(JSON.stringify({applied:apply,documents:records.length,events:Object.values(types).reduce((a,b)=>a+b,0),eventTypes:types,primaryReviewed:rows.filter(r=>r.projection.primaryReviewed).length,review:rows.filter(r=>r.projection.status==='REVIEW').length,diagnostics:diagnostics.filter(d=>d.status!=='OK'),plan:out}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

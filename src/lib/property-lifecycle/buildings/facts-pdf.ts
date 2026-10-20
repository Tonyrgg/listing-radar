import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PUBLIC_RECORD_POLICY as P} from './public-record-policy';
import {extractPropertyFacts} from './property-facts';
const hosts=new Set(['bitonto.trasparenza-valutazione-merito.it','municipium-images-production.s3-eu-west-1.amazonaws.com','www.comune.bitonto.ba.it']);
/** Explicit deep operation only. Body/pages stay in memory, only bounded fact spans survive. */
export async function extractKnownPdfFacts(recordId:string,url:string,eventDate:string|null,fetcher:typeof fetch=fetch){
 const u=new URL(url);if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.username||u.password)throw Error('Unapproved fact document');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(P.requestTimeoutMs)});
 if(!response.ok)throw Error(`Fact PDF HTTP ${response.status}`);
 if(!/application\/pdf/i.test(response.headers.get('content-type')??''))throw Error('PDF unavailable: signed/HTML/other format requires review');
 const reader=response.body?.getReader();if(!reader)throw Error('Missing PDF body');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>P.maxPdfBytes)throw Error('Fact PDF size limit');chunks.push(c.value);}}
 catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 const body=Buffer.concat(chunks);if(body.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF magic');
 const sha=createHash('sha256').update(body).digest('hex'),at=new Date().toISOString();
 const script="import sys,json,io;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({'totalPages':len(r.pages),'pages':[{'page':i+1,'text':r.pages[i].extract_text()[:80000]} for i in range(min(20,len(r.pages)))]}))";
 const data=await new Promise<{totalPages:number;pages:Array<{page:number;text:string}>}>((resolve,reject)=>{
  const child=spawn('python',['-X','utf8','-c',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  const timer=setTimeout(()=>{child.kill();reject(Error('PDF extraction timeout'));},30000);
  child.stdout.on('data',chunk=>{out+=chunk.toString();if(out.length>2000000){child.kill();reject(Error('PDF text limit'));}});
  child.stderr.on('data',()=>{});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('PDF parser unavailable or unsupported document'));try{resolve(JSON.parse(out));}catch{reject(Error('PDF parser malformed response'));}});
  child.stdin.on('error',()=>{});child.stdin.end(body);
 });
 const events=data.pages.flatMap(p=>extractPropertyFacts(recordId,{text:p.text,field:'pdf.text',sourceUrl:url,sourceHash:sha,observedAt:at,page:p.page},eventDate));
 return {events:events.filter((v,i,a)=>a.findIndex(x=>x.event_type===v.event_type)===i),sha256:sha,pagesExamined:data.pages.length,totalPages:data.totalPages,bodyRetained:false};
}

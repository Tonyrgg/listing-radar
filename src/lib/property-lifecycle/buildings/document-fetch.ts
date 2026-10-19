import { createHash } from "node:crypto";
import { PUBLIC_RECORD_POLICY as P } from "./public-record-policy";
const HOSTS=new Set(["bitonto.trasparenza-valutazione-merito.it","municipium-images-production.s3-eu-west-1.amazonaws.com","www.comune.bitonto.ba.it"]);
/** Explicit on-demand inspection only. Never run in FAST; no PDF/body retained or personal text indexed. */
export async function inspectPublicPdf(url:string,fetcher:typeof fetch=fetch){
 const parsed=new URL(url);if(parsed.protocol!=="https:"||!HOSTS.has(parsed.hostname)||parsed.username||parsed.password)throw Error("Unapproved public document URL");
 const r=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(P.requestTimeoutMs)});
 if(!r.ok)throw Error(`Public PDF HTTP ${r.status}`);
 if(!/application\/pdf/i.test(r.headers.get("content-type")??""))throw Error("Public document is not a declared PDF");
 if(Number(r.headers.get("content-length"))>P.maxPdfBytes){await r.body?.cancel();throw Error("Public PDF exceeds configured size");}
 const reader=r.body?.getReader();if(!reader)throw Error("Public PDF has no body");
 const hash=createHash("sha256");let size=0,prefix=Buffer.alloc(0);
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>P.maxPdfBytes)throw Error("Public PDF exceeds configured size");if(prefix.length<5)prefix=Buffer.concat([prefix,chunk.value]).subarray(0,5);hash.update(chunk.value);}}
 catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 if(prefix.toString("ascii")!=="%PDF-")throw Error("Public document payload is not PDF");
 return{url,bytes:size,sha256:hash.digest("hex"),observedAt:new Date().toISOString(),bodyRetained:false,textExtracted:false};
}

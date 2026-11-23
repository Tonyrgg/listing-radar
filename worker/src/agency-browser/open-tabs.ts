import { chromium, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { portalBlock } from "./browse.js";
import { OPEN_TAB_BATCH_BYTES, OPEN_TAB_LIMIT, OPEN_TAB_MAX_BYTES, openTabSignature, openTabSource,
  type OpenTabCapture, type OpenTabOutcome } from "./open-tab-contract.js";

export type OpenTabProgress = { total: number; processed: number; results: OpenTabOutcome[]; running: boolean; message?: string };

async function bounded<T>(promise: Promise<T>) {
  const timeout = new AbortController();
  try {
    return await Promise.race([promise, delay(5_000, undefined, { signal: timeout.signal, ref: false }).then(() => {
      throw new Error("Scheda sospesa o caricamento incompleto. Riaprila e acquisiscila di nuovo.");
    })]);
  } finally { timeout.abort(); }
}

async function readTab(page: Page, url: string, parser?: string): Promise<OpenTabCapture> {
  const expression = `(() => {
    const heading = document.querySelector("h1")?.innerText || "";
    const visible = document.body?.innerText || "";
    const top = [document.title, heading, visible.length < 1600 ? visible : ""].join(" ");
    const state = document.readyState;
    if (state === "loading" || !heading || !visible.trim()) return { url: location.href, top, ready: false };
    ${parser ? `const capture = (() => { ${parser}; return globalThis.ListingRadarPortalParser.extract(); })();
      const names = ["canonicalUrl","title","description","price","sqm","rooms","floor","zone","addressRaw","latitude","longitude","portalDeclaredDate","metadataDatePublished","metadataDateModified","portalSortDate","sellerType","sellerName","transaction","imageUrls"];
      const fields = Object.fromEntries(names.map(name => [name, capture[name]]));
      return { url: location.href, top, ready: true, fields };` : `const doc = document.documentElement.cloneNode(true);
      doc.querySelectorAll("form,input,textarea,select,iframe,script:not([type='application/ld+json']),style").forEach(node => node.remove());
      return { url: location.href, top, ready: true, html: doc.outerHTML };`}
  })()`;
  const observed = await bounded(page.evaluate<{url:string;top:string;ready:boolean;html?:string;fields?:Record<string,unknown>}>(expression));
  if (openTabSource(observed.url)?.url !== url) throw new Error("L’indirizzo della scheda è cambiato durante la lettura.");
  if (portalBlock(200, observed.top)) throw new Error("Il portale mostra un blocco o una verifica.");
  if (!observed.ready) throw new Error("Dettaglio incompleto. Verifica che la scheda sia caricata.");
  const capture = { url, capturedAt: new Date().toISOString(), html: observed.html, fields: observed.fields };
  if (Buffer.byteLength(JSON.stringify(capture)) > OPEN_TAB_MAX_BYTES) throw new Error("Scheda troppo grande per una lettura verificabile.");
  return capture;
}

async function upload(captures: OpenTabCapture[], endpoint: string, key: string, signal: AbortSignal): Promise<OpenTabOutcome[]> {
  const body = JSON.stringify({ captures });
  const timestamp = Date.now().toString();
  const response = await fetch(endpoint, { method:"POST", redirect:"error", body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    headers: { "Content-Type":"application/json", "X-Worker-Time":timestamp, "X-Worker-Signature":openTabSignature(key,timestamp,body) } });
  if (!response.ok) throw new Error(response.status === 401 ? "Autorizzazione Listing Radar non valida per questo Worker." : `Salvataggio non confermato da Listing Radar (HTTP ${response.status}).`);
  const payload = await response.json() as {results?: OpenTabOutcome[]};
  if (!Array.isArray(payload.results) || payload.results.length !== captures.length || payload.results.some((item,index) =>
    item.url !== captures[index]?.url || !["new","updated","unchanged","review","skipped","error"].includes(item.state))) {
    throw new Error("Risposta di salvataggio incompleta. Puoi ripetere l’acquisizione.");
  }
  return payload.results;
}

export async function acquireOpenTabs(input: {cdpUrl:string;endpoint:string;key:string;parserDirectory:string;signal:AbortSignal},
  send:(progress:OpenTabProgress)=>void) {
  const {signal}=input;
  const address=new URL(input.cdpUrl);
  if (address.protocol!=="http:" || !["127.0.0.1","localhost"].includes(address.hostname) || !address.port) throw new Error("Indirizzo del Chrome di lavoro non valido.");
  const browser = await chromium.connectOverCDP(address.origin,{timeout:8000}).catch(()=>{throw new Error("Apri il Chrome di lavoro con gli annunci che vuoi acquisire.");});
  try {
    const tabs=browser.contexts().flatMap(context=>context.pages()).flatMap(page=>{
      const detail=openTabSource(page.url());
      return detail?[{page,...detail}]:[];
    });
    if(tabs.length>OPEN_TAB_LIMIT)throw new Error(`Trovate ${tabs.length} schede. L’acquisizione ne gestisce fino a ${OPEN_TAB_LIMIT} per volta.`);
    const results:OpenTabOutcome[]=[];
    const emit=(running:boolean,message?:string)=>send({total:tabs.length,processed:results.length,results:[...results],running,message});
    emit(true);
    const parsers=new Map<string,string>();
    const seen=new Set<string>();
    let batch:OpenTabCapture[]=[];
    let batchBytes=0;
    let failedSave=false;
    async function flush() {
      if(!batch.length)return;
      try { results.push(...await upload(batch,input.endpoint,input.key,signal)); }
      catch(error) {
        failedSave=true;
        const message=signal.aborted ? "Salvataggio interrotto, esito da verificare." : error instanceof Error?error.message:"Salvataggio non confermato.";
        results.push(...batch.map(capture=>({url:capture.url,state:"error" as const,message})));
      }
      batch=[];batchBytes=0;emit(true);
    }
    for(const { page, source, url } of tabs) {
      if(signal.aborted||failedSave)break;
      if(seen.has(url)){results.push({url,state:"skipped",message:"Scheda duplicata nel batch."});emit(true);continue;}
      try {
        if(page.isClosed())throw new Error("Scheda chiusa prima della lettura.");
        let parser=parsers.get(source.id);
        if(source.portal&&!parser){
          const files=await Promise.all(["generic","shared",source.id,"portals"].map(name=>readFile(join(input.parserDirectory,name+".js"),"utf8")));
          parser=files.join(";\n");parsers.set(source.id,parser);
        }
        const capture=await readTab(page,url,parser);
        if(signal.aborted)break;
        const size=Buffer.byteLength(JSON.stringify(capture))+1;
        if(batch.length>=6||batchBytes+size>OPEN_TAB_BATCH_BYTES-32)await flush();
        if(failedSave||signal.aborted)break;
        batch.push(capture);batchBytes+=size;seen.add(url);
      }catch(error){
        results.push({url,state:"review",message:error instanceof Error?error.message.split("\n")[0]:"Scheda illeggibile."});emit(true);
      }
    }
    if(!signal.aborted&&!failedSave)await flush();
    emit(false,signal.aborted?"Acquisizione interrotta. Puoi ripeterla.":failedSave?"Acquisizione fermata dopo un errore di salvataggio. Puoi ripeterla.":tabs.length?"Acquisizione terminata.":"Apri almeno una scheda annuncio di una fonte riconosciuta.");
  } finally {
    await Promise.race([browser.close().catch(()=>undefined),delay(1500,undefined,{ref:false})]);
  }
}

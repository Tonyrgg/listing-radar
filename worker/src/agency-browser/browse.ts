import { chromium, type Page, type Response } from "playwright";
import { agencyHost, catalogLink, detailLink, localAgencyUrl, portalControlLink, type AgencySource } from "./sources.js";

const MAX_CATALOG_PAGES = 150;
const MAX_DETAILS = 2000;
const MAX_PORTAL_PRIVATE_DETAILS = 100;
const MAX_PORTAL_SEARCH_DETAILS = 25;
const NAVIGATION_TIMEOUT = 20_000;

export type AgencyProgress = {
  source: string;
  phase: "catalog" | "details" | "done" | "stopped" | "blocked" | "partial";
  pages: number;
  found: number;
  visited: number;
  failed: number;
  message?: string;
  url?: string;
};
class CatalogBlocked extends Error {}
class NoCatalog extends Error {}

async function navigate(page: Page,url:string,source:AgencySource,signal:AbortSignal) {
  signal.throwIfAborted();
  const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:NAVIGATION_TIMEOUT});
  signal.throwIfAborted();
  if(response && [401,403,429].includes(response.status()))throw new CatalogBlocked(`Accesso limitato dal sito (HTTP ${response.status()})`);
  if(!response?.ok()||!localAgencyUrl(page.url(),url,source))throw new Error("Pagina non raggiungibile");
  const blocked=await page.evaluate(()=>/^(?:just a moment|attention required|access denied|request blocked|verifica di sicurezza)/i.test(document.title.trim()));
  if(blocked)throw new CatalogBlocked("Il sito richiede una verifica nel browser");
}

function details(hrefs:string[],pageUrl:string,source:AgencySource) {
  return [...new Set(hrefs.flatMap(href=>{
    const url=localAgencyUrl(href,pageUrl,source);
    const detail=url&&detailLink(url,source);
    return detail?[detail]:[];
  }))];
}

function nextCatalog(href: string,pageUrl: string,source: AgencySource,root: string) {
  const url=localAgencyUrl(href,pageUrl,source);
  return url&&catalogLink(url,source,root) ? url.href : null;
}

function catalogPageKey(value:string) {
  const url=new URL(value);
  url.hostname=agencyHost(url);
  return url.href.replace(/\/page\/1\/?(?=\?|$)/i,"/").replace(/\/$/,"");
}

type GarofaloPayload = { result?:boolean; data?:{properties?:Record<string,unknown>[];properties_count_all_filtered?:unknown} };
function garofaloRead(response:Response){
  const url=new URL(response.url()),req=response.request(),form=new URLSearchParams(req.postData()??"");
  return agencyHost(url)==="garofaloimmobiliare.com"&&url.pathname==="/manager/includer.php"&&
    req.method()==="POST"&&form.get("action")==="read_properties"&&form.get("realestate_id")==="50"&&
    form.getAll("filter[agreement_id][]").includes("1")&&Number(form.get("start"))===0;
}

/** Garofalo displays a paged widget. Read its public listing response from the
 * open tab and keep the widget's filters while advancing its page offset. */
async function readGarofalo(page: Page,source: AgencySource,signal:AbortSignal,collect:(urls:string[])=>void) {
  const pending=page.waitForResponse(garofaloRead,{timeout:15_000}).catch(()=>null);
  await navigate(page,source.catalog,source,signal);
  const response=await pending;
  if(!response)throw new NoCatalog("Il catalogo Garofalo non ha caricato il suo elenco");
  if([401,403,429].includes(response.status()))throw new CatalogBlocked(`Accesso limitato dal sito (HTTP ${response.status()})`);
  if(!response.ok())throw new NoCatalog("Il catalogo Garofalo non risponde");
  const endpoint=new URL(response.url());
  if(endpoint.origin!==new URL(page.url()).origin)throw new NoCatalog("Catalogo Garofalo non verificabile");
  const form=new URLSearchParams(response.request().postData()??"");
  const length=Number(form.get("length"));
  if(!Number.isInteger(length)||length<1||length>250)throw new NoCatalog("Paginazione Garofalo non riconosciuta");
  let payload:GarofaloPayload=await response.json();
  const total=Number(payload.data?.properties_count_all_filtered);
  if(!Number.isInteger(total)||total<0||total>MAX_DETAILS)throw new NoCatalog("Totale Garofalo non verificabile");
  for(let start=0;start<total;start+=length){
    signal.throwIfAborted();
    if(start){
      form.set("start",String(start));
      const next=await page.evaluate(async ({body,path})=>{
        const result=await fetch(path,{method:"POST",body:new URLSearchParams(body),redirect:"error",signal:AbortSignal.timeout(12_000)});
        return {status:result.status,data:result.ok?await result.json():null};
      },{body:form.toString(),path:endpoint.pathname+endpoint.search});
      if([401,403,429].includes(next.status))throw new CatalogBlocked(`Accesso limitato dal sito (HTTP ${next.status})`);
      if(next.status!==200)throw new Error(`Pagina Garofalo non letta (HTTP ${next.status})`);
      payload=next.data;
    }
    const rows=payload.data?.properties;
    if(payload.result!==true||!rows||rows.length!==Math.min(length,total-start)||Number(payload.data?.properties_count_all_filtered)!==total)throw new Error("Il catalogo Garofalo è cambiato durante la lettura");
    collect(rows.flatMap(row=>{
      if(String(row.realestate_id)!=="50"||String(row.agreement_id)!=="1"||
        String(row.is_visible)!=="1"||String(row.is_active)!=="1"||!/^\d+$/.test(String(row.id)))return [];
      const slug=String(row.title??row.address??row.id).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120)||String(row.id);
      return [`${endpoint.origin}/realestate-detail/reid/${row.id}/${slug}`];
    }));
    if(start+length<total)await page.waitForTimeout(500);
  }
}

async function readCatalog(page:Page,source:AgencySource,root:string,signal:AbortSignal,collect:(urls:string[])=>void,openCatalog?:Page) {
  if(!openCatalog)await navigate(page,root,source,signal);
  async function dismissVistoCookies(){
    const choices=page.locator("#cc--main #c-s-bn");
    if(!await choices.isVisible())return false;
    await choices.click({timeout:4000});
    await page.locator("#cc--main #s-rall-bn").click({timeout:4000});
    return true;
  }
  const seenPages=new Set<string>(),seenContent=new Set<string>(),pending=new Set<string>();
  const vistaPager="a[href*='datarpt_paginazione']:visible";
  const resources=agencyHost(new URL(root))==="risorseimmobiliari.it";
  let resourcesPage=1;
  let attempts=0;
  let repeated=false;
  let current=openCatalog??page;
  while(true){
    signal.throwIfAborted();
    if(++attempts>MAX_CATALOG_PAGES)throw new Error("Raggiunto il limite di pagine del catalogo");
    if(!catalogLink(new URL(current.url()),source,root))throw new NoCatalog("Il sito ha aperto una pagina diversa dal catalogo dell’agenzia");
    const hrefs=(selector:string)=>current.locator(selector).evaluateAll(elements=>elements.map(element=>element.getAttribute("href")??""));
    const anchors=await hrefs("a[href],link[rel=next][href]");
    let listingAnchors=anchors;
    if(source.id==="vistocasa")listingAnchors=await hrefs("a[href*='immobile.aspx']:visible");
    if(source.id==="studisanti"){
      listingAnchors=await current.locator("a[href*='/Vendite/' i]:visible").evaluateAll(elements=>elements
        .filter(element=>!element.closest("footer,aside,[role=complementary]"))
        .map(element=>element.getAttribute("href")??""));
    }
    const urls=details(listingAnchors,current.url(),source);
    if(!urls.length){
      if(source.id==="studisanti"&&!seenContent.size)throw new NoCatalog("Apri l’elenco Vendite di Studi Santi nel Chrome di lavoro e attendi che compaiano gli annunci.");
      if(!seenContent.size)throw new NoCatalog("Il sito non ha mostrato schede riconoscibili");
      throw new Error("Una pagina del catalogo è priva di schede riconoscibili");
    }
    const signature=urls.slice().sort().join("\n");
    if(seenContent.has(signature)){
      if(resources||source.id==="vistocasa")throw new Error("Il catalogo ha ripetuto la stessa pagina");
      repeated=true;
    }
    seenPages.add(catalogPageKey(current.url()));
    if(!seenContent.has(signature)){
      seenContent.add(signature);
      collect(urls);
    }
    if(source.id==="vistocasa"){
      const pager=page.locator(vistaPager);
      const numbered=await pager.evaluateAll(links=>links.map(link=>({label:(link.textContent??"").trim(),selected:link.classList.contains("selected")})));
      if(!numbered.length)break;
      const current=Number(numbered.find(row=>row.selected)?.label);
      if(!Number.isInteger(current)||current<1)throw new Error("Paginazione Vistocasa non leggibile");
      const next=numbered.filter(row=>/^\d+$/.test(row.label)&&Number(row.label)>current).sort((a,b)=>Number(a.label)-Number(b.label))[0];
      if(!next)break;
      const label=new RegExp(`^\\s*${next.label}\\s*$`);
      const nextPage=pager.filter({hasText:label});
      await dismissVistoCookies();
      try{await nextPage.click({timeout:5000});}
      catch(error){if(!await dismissVistoCookies())throw error;await nextPage.click({timeout:5000});}
      await page.locator("a.selected[href*='datarpt_paginazione']:visible").filter({hasText:label}).waitFor({timeout:NAVIGATION_TIMEOUT});
      continue;
    }
    if(resources){
      const label=String(resourcesPage+1);
      const next=page.locator(`a.page-link[href="javascript:change_page(${label});"]:visible`)
        .filter({hasText:new RegExp(`^\\s*${label}\\s*$`)});
      if(!await next.count())break;
      const selector="a.vediann[href]";
      const previous=await page.locator(selector).evaluateAll(elements=>elements.map(element=>element.getAttribute("href")).join("\n"));
      await next.click({timeout:5000});
      await page.waitForFunction(({selector,previous})=>{
        const current=Array.from(document.querySelectorAll(selector),element=>element.getAttribute("href")).join("\n");
        return Boolean(current&&current!==previous);
      },{selector,previous},{timeout:NAVIGATION_TIMEOUT});
      resourcesPage++;
      continue;
    }
    for(const href of anchors){
      const next=nextCatalog(href,current.url(),source,root);
      if(next&&!seenPages.has(catalogPageKey(next)))pending.add(next);
    }
    if(source.id==="futura"){
      const numbers=await page.locator("select[name=pagina] option").evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value));
      for(const number of numbers){
        if(!/^\d+$/.test(number)||Number(number)<2)continue;
        const next=new URL(root);
        next.searchParams.set("num_page",number);
        if(!seenPages.has(catalogPageKey(next.href)))pending.add(next.href);
      }
    }
    for(const candidate of pending)if(seenPages.has(catalogPageKey(candidate)))pending.delete(candidate);
    const next=pending.values().next().value;
    if(!next)break;
    pending.delete(next);
    seenPages.add(catalogPageKey(next));
    await navigate(page,next,source,signal);
    current=page;
  }
  if(repeated)throw new Error("Alcuni indirizzi del catalogo hanno ripetuto la stessa pagina");
  const firstPageCount=seenContent.values().next().value?.split("\n").length??0;
  if(source.id==="studisanti"&&seenContent.size===1&&firstPageCount<=3){
    throw new Error("Visibili poche schede. Elenco Vendite completo da verificare.");
  }
}

async function readSubitoResults(page:Page) {
  return page.evaluate(()=>{
    const content=document.getElementById("__NEXT_DATA__")?.textContent;
    if(!content)return null;
    try {
      type Result={urls?:{default?:unknown};advertiser?:{company?:unknown};date?:unknown};
      type ResultsState={originalList?:Result[];totalPages?:unknown};
      const state=(JSON.parse(content) as {props?:{pageProps?:{initialState?:{items?:ResultsState}}}}).props?.pageProps?.initialState?.items;
      if(!state||!Array.isArray(state.originalList))return null;
      const listings=state.originalList.flatMap((row:Result)=>{
        const url=row?.urls?.default;
        return typeof url==="string"?[{
          url,
          company:row.advertiser?.company===true,
          date:typeof row.date==="string"?row.date:"",
        }]:[];
      });
      const dated=listings.map(row=>row.date);
      return {
        urls:listings.filter(row=>!row.company).map(row=>row.url),
        records:listings.length,
        totalPages:Number.isInteger(state.totalPages)?Number(state.totalPages):0,
        recent:dated.length>0&&dated.every((date,index)=>/^\d{4}-\d{2}-\d{2} /.test(date)&&(index===0||dated[index-1]!>=date)),
      };
    }catch{return null;}
  });
}

async function readPortalCatalog(
  page:Page,
  source:AgencySource,
  signal:AbortSignal,
  collect:(urls:string[])=>void,
  setMode:(message:string)=>void,
) {
  let root=source.catalog;
  await navigate(page,root,source,signal);
  if(!catalogLink(new URL(page.url()),source,root))throw new NoCatalog("Il portale non ha aperto la ricerca di Bitonto.");
  let privateOnly=source.portal==="private";
  let recent=false;
  const controls=async (kind:"private"|"recent")=>{
    const links=await page.locator("a[href]:visible").evaluateAll(elements=>elements.map(element=>({
      label:(element.getAttribute("aria-label")||element.textContent||"").replace(/\s+/g," ").trim(),
      href:element.getAttribute("href")??"",
    })));
    const match=links.map(({href,label})=>portalControlLink(href,label,page.url(),source,kind)).find(Boolean);
    if(!match)return false;
    await navigate(page,match,source,signal);
    if(!catalogLink(new URL(page.url()),source,match))throw new NoCatalog("Il portale ha cambiato la ricerca di Bitonto.");
    root=match;
    return true;
  };
  if(!privateOnly)privateOnly=await controls("private");
  if(!privateOnly)recent=await controls("recent");
  const reportMode=(ordered:boolean)=>setMode(privateOnly?"Filtro privati · fino a 100 schede":
    ordered?"Fino a 25 annunci nel portale, dai più recenti":"Fino a 25 annunci nell’ordine mostrato dal portale");
  reportMode(recent);

  const cap=privateOnly?MAX_PORTAL_PRIVATE_DETAILS:MAX_PORTAL_SEARCH_DETAILS;
  const seenListings=new Set<string>();
  const seenPages=new Set<string>();
  const pending=new Set<string>();
  while(true){
    signal.throwIfAborted();
    const current=page.url();
    if(seenPages.has(catalogPageKey(current)))throw new Error("Il portale ha ripetuto la stessa pagina.");
    if(!catalogLink(new URL(current),source,root))throw new Error("Il portale è uscito dalla ricerca selezionata.");
    seenPages.add(catalogPageKey(current));
    const anchors=await page.locator("a[href]:visible,link[rel=next][href]").evaluateAll((elements,sourceId)=>elements.map(element=>{
      const card=element.closest("article,[class*='RealEstateItem'],.in-listing__item");
      const seller=card?.querySelector("[itemprop=seller],[data-testid*=advertiser i],[data-testid*=seller i],[class*=agency i]");
      return {
        href:element.getAttribute("href")??"",
        next:element.getAttribute("rel")==="next"||/^(?:pagina )?successiv[ao]$/i.test((element.getAttribute("aria-label")||element.getAttribute("title")||element.textContent||"").trim()),
        excluded:(sourceId==="casadaprivato"&&!element.closest("#property-listing"))||
          Boolean(seller&&/\b(?:agenzia|professionista)\b/i.test(seller.textContent??""))||
          Boolean(card&&/\ball['’]asta\b/i.test(element.textContent??"")),
      };
    }),source.id);
    const subito=source.id==="subito"?await readSubitoResults(page):null;
    if(subito){
      const pageNumber=Number(new URL(current).searchParams.get("o")??"1");
      if(pageNumber<subito.totalPages){
        const next=new URL(root);
        next.searchParams.set("o",String(pageNumber+1));
        pending.add(next.href);
      }
      recent=seenPages.size===1?subito.recent:recent&&subito.recent;
      reportMode(recent);
    }
    const urls=details(subito?.urls??anchors.filter(anchor=>!anchor.excluded).map(anchor=>anchor.href),current,source);
    if(!urls.length&&!subito?.records)throw new NoCatalog("Il portale non ha mostrato schede leggibili per questa ricerca.");
    const newListings=urls.filter(url=>!seenListings.has(url)).slice(0,cap-seenListings.size);
    if(!newListings.length&&urls.length)throw new Error("Il portale ha ripetuto le stesse schede.");
    for(const url of newListings)seenListings.add(url);
    collect(newListings);
    if(seenListings.size>=cap)return;
    let preferredPage:string|undefined;
    for(const anchor of anchors){
      const next=nextCatalog(anchor.href,current,source,root);
      if(next&&!seenPages.has(catalogPageKey(next))){
        if(anchor.next)preferredPage??=next;
        pending.add(next);
      }
    }
    const next=preferredPage??[...pending].find(url=>!seenPages.has(catalogPageKey(url)));
    if(!next)return;
    if(seenPages.size>=MAX_CATALOG_PAGES)throw new Error("Raggiunto il limite di pagine del portale.");
    pending.delete(next);
    await navigate(page,next,source,signal);
  }
}

export async function browseAgency(cdpUrl:string,source:AgencySource,signal:AbortSignal,send:(progress:AgencyProgress)=>void) {
  const endpoint=new URL(cdpUrl);
  if(endpoint.protocol!=="http:"||!["localhost","127.0.0.1"].includes(endpoint.hostname)||!endpoint.port||
    endpoint.pathname!=="/"||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw new Error("Indirizzo del Chrome di lavoro non valido");
  const browser=await chromium.connectOverCDP(endpoint.origin,{timeout:8000}).catch(()=>{throw new Error("Apri il Chrome di lavoro e riprova.")});
  const links=new Set<string>();
  const progress:AgencyProgress={source:source.id,phase:"catalog",pages:0,found:0,visited:0,failed:0};
  const emit=(phase:AgencyProgress["phase"],message?:string,url?:string)=>send({...progress,phase,message,url});
  let page:Page|undefined;
  let navigationGuard:Parameters<Page["route"]>[1]|undefined;
  try {
    const context=browser.contexts()[0];
    if(!context)throw new Error("Profilo del Chrome di lavoro non trovato");
    signal.throwIfAborted();
    const openCatalog=source.id==="studisanti"?context.pages().find(tab=>{
      const url=localAgencyUrl(tab.url(),source.catalog,source);
      return url&&catalogLink(url,source,source.catalog);
    }):undefined;
    page=await context.newPage();
    await page.bringToFront();
    const tab=page;
    navigationGuard=route=>{
      const request=route.request();
      if(request.isNavigationRequest()&&request.frame()===tab.mainFrame()&&!localAgencyUrl(request.url(),source.catalog,source))return route.abort();
      return route.fallback();
    };
    await page.route("**/*",navigationGuard);
    let scanMode:string|undefined;
    const collect=(urls:string[])=>{
      for(const url of urls)links.add(url);
      progress.pages++;progress.found=links.size;
      if(links.size>MAX_DETAILS)throw new Error("Raggiunto il limite di schede del catalogo");
      emit("catalog",scanMode,tab.url()==="about:blank"?openCatalog?.url():tab.url());
    };
    emit("catalog",undefined,source.catalog);
    let catalogIssue:string|undefined;
    try{
      if(source.portal)await readPortalCatalog(page,source,signal,collect,message=>{scanMode=message;});
      else if(source.id==="garofalo")await readGarofalo(page,source,signal,collect);
      else {
        if(openCatalog)scanMode="Lettura dalla pagina Vendite già aperta";
        try{await readCatalog(page,source,source.catalog,signal,collect,openCatalog);}
        catch(error){
          if(!(error instanceof NoCatalog)||!source.secondaryCatalog||links.size)throw error;
          emit("catalog","Apro il catalogo pubblico alternativo dell’agenzia.",source.secondaryCatalog);
          await readCatalog(page,source,source.secondaryCatalog,signal,collect);
        }
      }
    }catch(error){
      if(error instanceof CatalogBlocked||signal.aborted||!links.size)throw error;
      catalogIssue=error instanceof Error?error.message.split("\n")[0]:"Catalogo letto in parte";
    }
    if(!links.size)throw new NoCatalog("Nessuna scheda trovata nel catalogo");
    const summary=[scanMode,catalogIssue].filter(Boolean).join(" · ")||undefined;
    for(const url of links){
      signal.throwIfAborted();
      emit("details",summary,url);
      try{
        await navigate(page,url,source,signal);
        const actual=localAgencyUrl(page.url(),url,source);
        if(!actual||!detailLink(actual,source))throw new Error("La pagina non è una scheda dell’agenzia");
        progress.visited++;
      }catch(error){
        if(error instanceof CatalogBlocked||signal.aborted||page.isClosed())throw error;
        progress.failed++;
      }
      await page.waitForTimeout(650);
    }
    emit(catalogIssue||progress.failed?"partial":"done",summary,page.url());
  }catch(error){
    if(signal.aborted)emit("stopped","Scansione interrotta.",page?.url());
    else emit(error instanceof CatalogBlocked?"blocked":"partial",error instanceof Error?error.message.split("\n")[0]:"Lettura non riuscita",page?.url());
  }finally{
    if(page&&!page.isClosed()&&navigationGuard)await page.unroute("**/*",navigationGuard).catch(()=>undefined);
    await browser.close().catch(()=>undefined);
  }
}

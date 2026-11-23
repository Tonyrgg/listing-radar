export type AgencySource = {
  id: string;
  label: string;
  catalog: string;
  icon?: string;
  detailPath: RegExp;
  detailQuery?: string;
  urlScope?: RegExp;
  pageParameters?: readonly string[];
  secondaryCatalog?: string;
  portal?: "private" | "search";
};

export const agencySources: readonly AgencySource[] = [
  { id:"admaiora", label:"Ad Maiora", icon:"admaiora.png", catalog:"https://www.admaioraimmobiliare.it/vendita/", detailPath:/^\/immobile\/[^/]+\/?$/i, urlScope:/^\/vendita(?:\/page\/\d+)?\/?$/i },
  { id:"futura", label:"Futura", icon:"futura.png", catalog:"https://www.futurabitonto.it/web/immobili.asp?language=ita&pagref=88306&tipo_contratto=V", detailPath:/^\/web\/[\w-]+\.asp$/i, detailQuery:"cod_annuncio", pageParameters:["num_page"],
    secondaryCatalog:"https://www.risorseimmobiliari.it/agenzie_immobiliari/Gap-Real-Estate-Sas-di-Andrea-de-Sario-e-c-19695.html" },
  { id:"garofalo", label:"Garofalo", icon:"garofalo.png", catalog:"https://garofaloimmobiliare.com/immobili", detailPath:/^\/realestate-detail\/reid\/\d+(?:\/[^/?#]+)?\/?$/i },
  { id:"iconacasa", label:"Iconacasa", icon:"iconacasa.ico", catalog:"https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro", detailPath:/^\/index\.php\/opportunita\/property\/\d+(?:-[^/]+)?\/?$/i,pageParameters:["start"] },
  { id:"momento", label:"Momento Casa", catalog:"https://www.trovacasa.it/agenzie-immobiliari/momento-casa-bitonto-tc-96100/annunci", detailPath:/^\/annunci\/[a-z]{2}-tc-96100-\d+\/?$/i,pageParameters:["page","pg","p"] },
  { id:"puntocasa", label:"Punto Casa", icon:"puntocasa.jpg", catalog:"https://www.puntocasagroup.it/acquista-la-tua-casa-2/", detailPath:/^\/property-item\/[^/]+\/?$/i,urlScope:/^\/acquista-la-tua-casa-2(?:\/page\/\d+)?\/?$/i },
  { id:"studiocasa", label:"Studio Casa", catalog:"https://www.casa.it/agenzie/studio-casa-bitonto-1098672/", detailPath:/^\/immobili\/\d+\/?$/i,pageParameters:["page","pg"],urlScope:/^\/agenzie\/studio-casa-bitonto-1098672(?:\/page\/\d+)?\/?$/i },
  { id:"studisanti", label:"Studi Santi", catalog:"https://www.studisantiimmobiliare.it/it/Vendite/", detailPath:/^\/it\/vendite\/[^/]+\/[^/]+\/[vm]\d+\/\d+\/?$/i,pageParameters:["p"],urlScope:/^\/it\/vendite(?:\/(?:pagina\/)?\d+)?\/?$/i },
  { id:"vistocasa", label:"Vistocasa", icon:"vistocasa.ico", catalog:"https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56", detailPath:/^\/it\/immobile\.aspx$/i,detailQuery:"articoliid" },
];

export const portalSources: readonly AgencySource[] = [
  {id:"immobiliare",label:"Immobiliare.it",icon:"immobiliare.ico",portal:"private",
    catalog:"https://www.immobiliare.it/vendita-case/bitonto/da-privati/",detailPath:/^\/annunci\/\d+\/?$/i,pageParameters:["pag","page"]},
  {id:"idealista",label:"Idealista",portal:"search",
    catalog:"https://www.idealista.it/vendita-case/bitonto-bari/",detailPath:/^\/immobile\/\d+\/?$/i,
    urlScope:/^\/vendita-case\/bitonto-bari(?:\/pagina-\d+\.htm)?\/?$/i,pageParameters:["pagina","page"]},
  {id:"casa",label:"Casa.it",icon:"casa.ico",portal:"private",
    catalog:"https://www.casa.it/vendita/residenziale/bitonto/con-da-privati/",detailPath:/^\/immobili\/\d+\/?$/i,pageParameters:["page","pg"]},
  {id:"subito",label:"Subito",icon:"subito.ico",portal:"search",
    catalog:"https://www.subito.it/annunci-puglia/vendita/immobili/bari/bitonto/",detailPath:/^\/(?:appartamenti|ville-singole-e-a-schiera|terreni-e-rustici|garage-e-box|uffici-locali-commerciali|case-vacanza|loft-mansarde-e-altro)\/[^/]+-\d+\.htm$/i,pageParameters:["o","page"]},
  {id:"casadaprivato",label:"CasaDaPrivato",icon:"casadaprivato.ico",portal:"private",
    catalog:"https://www.casadaprivato.it/annunci-vendita/immobili/bari-bitonto",detailPath:/^\/[^/]+\/[^/]+-\d+\/?$/i,
    urlScope:/^\/annunci-vendita\/immobili\/bari-bitonto(?:\/pagina-\d+)?\/?$/i},
];

export const browserSources = [...agencySources,...portalSources];

export function agencyHost(url: URL) {
  return url.hostname.replace(/^www\./i, "");
}
export function localAgencyUrl(href:string,from:string,source:AgencySource):URL|null {
  try{
    const url=new URL(href,from);
    const hosts=[source.catalog,source.secondaryCatalog].filter((value):value is string=>Boolean(value)).map(value=>agencyHost(new URL(value)));
    if(url.protocol!=="https:"||url.port||url.username||url.password||!hosts.includes(agencyHost(url)))return null;
    url.hash="";
    return url;
  }catch{return null;}
}
function queryValue(url:URL,name:string) {
  return [...url.searchParams].find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
}
export function detailLink(url:URL,source:AgencySource):string|null {
  if(agencyHost(url)==="risorseimmobiliari.it"){
    if(source.id!=="futura"||!/^\/bari\/(?:vendita|affitto)-.+-\d+\.html$/i.test(url.pathname))return null;
  }else if(!source.detailPath.test(url.pathname))return null;
  if(source.detailQuery&&agencyHost(url)!=="risorseimmobiliari.it"){
    const id=queryValue(url,source.detailQuery);
    if(!id||!/^\d+$/.test(id))return null;
    if(source.id==="vistocasa")url.search="?ArticoliId="+id;
  } else {url.search="";}
  return url.href.replace(/\/$/,"");
}
const portalControlLabel = {
  private: /^(?:solo (?:da )?privati|da privati|annunci da privati|venditore privato|privati)$/i,
  recent: /^(?:(?:ordina per[: ]+)?(?:pi[uù] recenti|dal pi[uù] recente|data pi[uù] recente)|data (?:di )?pubblicazione decrescente)$/i,
};

export function portalControlLink(
  href: string,
  label: string,
  current: string,
  source: AgencySource,
  kind: keyof typeof portalControlLabel,
): string | null {
  if (!source.portal || !portalControlLabel[kind].test(label.trim())) return null;
  const url = localAgencyUrl(href, current, source);
  if (!url || url.href === current) return null;
  const original = new URL(current);
  const samePath = url.pathname.replace(/\/$/, "") === original.pathname.replace(/\/$/, "");
  if (kind === "private") {
    if (!samePath) return null;
    // Sorting private listings first does not make a search private-only.
    const privateQuery = [...url.searchParams].some(([key, value]) =>
      /^(?:seller(?:_type)?|user(?:_type)?|advertiser(?:_type)?|publisher(?:_type)?|tipo_utente|inserzionista)$/i.test(key) &&
      /^(?:private|privato|privati)$/i.test(value),
    );
    return privateQuery ? url.href : null;
  }
  if (!samePath) return null;
  for (const [key, value] of original.searchParams) {
    if (!/^(?:sort|sortBy|order|ordine|ordinamento|orderBy)$/i.test(key) && url.searchParams.get(key) !== value) return null;
  }
  return [...url.searchParams].some(([key, value]) =>
    /^(?:sort|sortBy|order|ordine|ordinamento|orderBy)$/i.test(key) && original.searchParams.get(key) !== value,
  ) ? url.href : null;
}

export function catalogLink(url:URL, source:AgencySource, rootValue:string):boolean {
  const root=new URL(rootValue);
  if(agencyHost(url)!==agencyHost(root))return false;
  const path=url.pathname.replace(/\/$/,""),base=root.pathname.replace(/\/$/,"");
  const scopedPage=agencyHost(root)!=="risorseimmobiliari.it"&&source.urlScope?.test(url.pathname)&&
    (!source.portal||path.startsWith(base+"/"));
  const portalNumberedPage=Boolean(source.portal)&&path.startsWith(base+"/")&&/^\/page\/\d+$/i.test(path.slice(base.length));
  if(path!==base&&!scopedPage&&!portalNumberedPage)return false;
  const pageKeys=new Set([...(source.pageParameters??[]),...(agencyHost(root)==="risorseimmobiliari.it"?["page","pag","pagina"]:[])]);
  for(const [key,value] of root.searchParams)if(!pageKeys.has(key)&&queryValue(url,key)!==value)return false;
  for(const [key,value] of url.searchParams){
    if(!root.searchParams.has(key)&&!(pageKeys.has(key)&&/^\d+$/.test(value)))return false;
  }
  return true;
}

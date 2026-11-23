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
  { id:"studisanti", label:"Studi Santi", catalog:"https://www.studisantiimmobiliare.it/it/Vendite/", detailPath:/^\/it\/vendite\/.+\/\d+\/?$/i,pageParameters:["page","pagina","p"],urlScope:/^\/it\/vendite(?:\/(?:pagina\/)?\d+)?\/?$/i },
  { id:"vistocasa", label:"Vistocasa", icon:"vistocasa.ico", catalog:"https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56", detailPath:/^\/it\/immobile\.aspx$/i,detailQuery:"articoliid" },
];

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
export function catalogLink(url:URL, source:AgencySource, rootValue:string):boolean {
  const root=new URL(rootValue);
  if(agencyHost(url)!==agencyHost(root))return false;
  const path=url.pathname.replace(/\/$/,""),base=root.pathname.replace(/\/$/,"");
  if(path!==base&&!(agencyHost(root)!=="risorseimmobiliari.it"&&source.urlScope?.test(url.pathname)))return false;
  const pageKeys=new Set([...(source.pageParameters??[]),...(agencyHost(root)==="risorseimmobiliari.it"?["page","pag","pagina"]:[])]);
  for(const [key,value] of root.searchParams)if(!pageKeys.has(key)&&queryValue(url,key)!==value)return false;
  for(const [key,value] of url.searchParams){
    if(!root.searchParams.has(key)&&!(pageKeys.has(key)&&/^\d+$/.test(value)))return false;
  }
  return true;
}

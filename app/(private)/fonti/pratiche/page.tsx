import type {Metadata} from 'next';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeader} from '@/components/page-header';
import {Card,Chip,EmptyState,Meta,buttonClass} from '@/components/ui/primitives';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {formatDate,formatDateTime} from '@/lib/formatting';
import {safeAlboUrl} from '@/lib/property-lifecycle/buildings/albo';

export const metadata:Metadata={title:'Pratiche e documenti'};
const states:Record<string,string>={PENDING:'Ricerca da eseguire',STALE:'Documenti da ricontrollare',LINKED:'Allegato trovato',NO_ATTACHMENT:'Atto senza allegati',NO_MATCH:'Atto da reperire',AMBIGUOUS:'Più atti da verificare',IDENTIFIERS_MISSING:'Riferimenti incompleti'};
const types:Record<string,string>={FRAZIONAMENTO:'Frazionamento',FUSIONE_ACCOPPIAMENTO:'Fusione / accorpamento',CAMBIO_DESTINAZIONE_USO:'Cambio di destinazione d’uso',land:'Terreni e urbanistica',NUOVA_COSTRUZIONE:'Nuova costruzione',AGIBILITA:'Agibilità',FINE_LAVORI:'Fine lavori'};
const topicByType:Record<string,string[]>={FRAZIONAMENTO:['SPLIT'],FUSIONE_ACCOPPIAMENTO:['MERGE'],CAMBIO_DESTINAZIONE_USO:['USE_CHANGE'],land:['BUILDABILITY_MENTION','PLANNING_CHANGE'],NUOVA_COSTRUZIONE:['NEW_BUILDING'],AGIBILITA:['COMPLETION'],FINE_LAVORI:['COMPLETION']};
type QueueRow={index_record_id:string;application_code:string;practice_number:string|null;protocol_number:string|null;protocol_date:string|null;intervention_type:string;search_state:string;candidate_count:number|null;checked_at:string|null;primary_record_id:string|null;primary_source_url:string|null;document_urls:string[];source_key:string;search_topics:string[]};

export default async function PracticeDocuments({searchParams}:{searchParams:Promise<{pagina?:string;stato?:string;tipo?:string;pratica?:string}>}){
 await connection();
 const params=await searchParams,page=Math.max(1,Math.min(10000,Math.floor(Number(params.pagina)||1))),practice=params.pratica?.trim().slice(0,80)??'';
 const state=params.stato&&states[params.stato]?params.stato:'';
 const type=params.tipo==='tutte'?'tutte':params.tipo&&types[params.tipo]?params.tipo:'utili';
 const db=await getSupabaseServerClient();
 let query=db.from('market_observer_practice_document_queue').select('*',{count:'exact'});
 if(state)query=query.eq('search_state',state);
 if(practice)query=query.eq('practice_number',practice);
 if(type==='utili')query=query.overlaps('search_topics',[...new Set(Object.values(topicByType).flat())]);
 else if(type!=='tutte'){
  query=query.overlaps('search_topics',topicByType[type]);
  if(type==='AGIBILITA'||type==='FINE_LAVORI')query=query.eq('intervention_type',type);
 }
 const result=await query.order('protocol_date',{ascending:false,nullsFirst:false}).order('index_record_id').range((page-1)*25,page*25-1);
 const rows=(result.data??[]) as QueueRow[];
 const pageUrl=(number:number)=>'?'+new URLSearchParams({pagina:String(number),stato:state,tipo:type,pratica:practice}).toString();
 return <div className="space-y-5">
  <PageHeader title="Pratiche e documenti" description="Le pratiche comunali da approfondire e gli atti pubblici che possiamo collegare con riferimenti precisi." backHref="/fonti" backLabel="Fonti"/>
  <div className="lr-practice-guide"><p>Questa è la coda di ricerca degli atti: ogni riga parte da una pratica trovata nei registri comunali. La categoria indica l’intervento dichiarato, non un lavoro già realizzato o una casa in vendita.</p><p><strong>Come usarla:</strong> filtra per intervento, apri una riga e controlla il documento. Se l’allegato manca, puoi consultare la pubblicazione o cercare il numero nel registro territoriale. Solo la lettura dell’atto permette di verificare esito e luogo.</p><Meta>Un riferimento di pratica non identifica automaticamente una singola unità. Le procedure giudiziarie sono escluse.</Meta></div>
  <form className="lr-filter-toolbar flex flex-wrap items-end gap-3">
   <label className="grid gap-1" htmlFor="practice-number">Numero pratica<input id="practice-number" name="pratica" defaultValue={practice} maxLength={80} className="lr-control min-h-11 rounded border px-3"/></label>
   <div className="grid gap-1"><label htmlFor="practice-type">Intervento</label><select id="practice-type" name="tipo" defaultValue={type} className="lr-control rounded border p-2"><option value="utili">Trasformazioni e lavori conclusi</option>{Object.entries(types).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="tutte">Tutte le pratiche</option></select></div>
   <div className="grid gap-1"><label htmlFor="practice-document-state">Documento</label><select id="practice-document-state" name="stato" defaultValue={state} className="lr-control rounded border p-2"><option value="">Tutti gli stati</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   <button className={buttonClass('secondary')}>Filtra</button>
  </form>
  {result.error?<Card className="p-4"><EmptyState title="La coda documenti non è disponibile" description="La lettura delle pratiche non è riuscita. Riprova dopo il completamento dell’aggiornamento delle fonti."/></Card>:<>
   <Meta>{result.count??rows.length} pratiche nel filtro · pagina {page}</Meta>
   <div className="lr-practice-register">{rows.map(row=>{
    const documents=[...new Set((row.document_urls??[]).flatMap(url=>{try{return [safeAlboUrl(url)];}catch{return [];}}))];
    return <details key={row.index_record_id} className="lr-practice-row">
     <summary><div><h2 className="font-[650]">{types[row.intervention_type]??(row.search_topics?.some(topic=>topicByType.land.includes(topic))?'Terreno / urbanistica da verificare':'Pratica da approfondire')} · {row.practice_number??'numero non disponibile'}</h2><p className="lr-record-meta">{documents.length?`${documents.length} allegati consultabili`:row.primary_source_url?'Pubblicazione disponibile, documento da verificare':'Documento primario non reperito'}</p></div><Chip tone={row.search_state==='LINKED'?'action':row.search_state==='AMBIGUOUS'||row.search_state==='STALE'?'warn':'neutral'}>{states[row.search_state]??'Da verificare'}</Chip></summary><div className="lr-practice-content">
     <Meta>Registro {row.application_code.toUpperCase()} · {row.source_key==='comune-bitonto-protocolli-territorio'?'protocolli Territorio / SUAP':'edilizia 2025'} · protocollo {row.protocol_number??'non disponibile'} del {row.protocol_date?formatDate(row.protocol_date):'data non disponibile'}</Meta>
     <p>{row.search_state==='LINKED'?'Riferimenti amministrativi coincidenti: apri gli allegati e verifica l’esito della pratica.':row.search_state==='NO_ATTACHMENT'?'La pubblicazione corrispondente non espone allegati consultabili.':row.search_state==='AMBIGUOUS'?`${row.candidate_count} pubblicazioni hanno gli stessi riferimenti: occorre verificare quale documento corrisponde.`:row.search_state==='IDENTIFIERS_MISSING'?'Manca un riferimento necessario per collegare la pratica con certezza.':row.search_state==='STALE'?'Il registro o l’atto sono cambiati: il collegamento deve essere ricalcolato.':'Nelle pubblicazioni acquisite non è stato individuato un atto con tutti i riferimenti coincidenti.'}</p>
     <div><h3 className="font-semibold">Prossimo passo</h3><p>{documents.length?"Leggi l’allegato: verifica se si tratta di richiesta, autorizzazione o conclusione. Controlla indirizzo e riferimenti prima di collegarlo a un immobile.":row.primary_source_url?"Apri la pubblicazione ufficiale e verifica se gli allegati sono consultabili alla fonte.":"Cerca il numero della pratica nei documenti territoriali già acquisiti. Se non compare, l’atto primario resta da reperire: non possiamo ricostruire l’esito dal solo registro."}</p></div>
     <div className="flex flex-wrap gap-4">{row.primary_source_url?<a className="underline" href={safeAlboUrl(row.primary_source_url)} target="_blank" rel="noreferrer">Pubblicazione ufficiale</a>:null}{documents.map((url,index)=><a key={url} className="underline" href={url} target="_blank" rel="noreferrer">Allegato {index+1}</a>)}<Link className="underline" href={`/map?${new URLSearchParams({documento:row.practice_number??row.protocol_number??row.application_code})}#documenti-pubblici`}>Cerca riferimenti nel registro</Link>{row.primary_record_id?<Link className="underline" href={`/map?atto=${row.primary_record_id}#atto`}>Contesto dell’atto</Link>:null}</div>
     {row.checked_at?<Meta>Ultimo confronto {formatDateTime(row.checked_at)}</Meta>:null}
    </div></details>;
   })}</div>
   {!rows.length?<Card className="p-4"><EmptyState title="Nessuna pratica in questo filtro" description="Cambia intervento o stato del documento per consultare le altre pratiche."/></Card>:null}
   <nav aria-label="Pagine delle pratiche" className="flex justify-between">{page>1?<Link href={pageUrl(page-1)}>Precedenti</Link>:<span/>}{page*25<(result.count??0)?<Link href={pageUrl(page+1)}>Successivi</Link>:null}</nav>
  </>}
 </div>;
}

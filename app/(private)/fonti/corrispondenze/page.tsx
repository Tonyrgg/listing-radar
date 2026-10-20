import Link from 'next/link';
import type {Metadata} from 'next';
import {connection} from 'next/server';
import {PageHeader} from '@/components/page-header';
import {Card,Meta,Chip,buttonClass} from '@/components/ui/primitives';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {decideStreet} from './actions';
export const metadata:Metadata={title:'Corrispondenze territoriali'};
type Ref={streetName:string;locality:string;civicText:string|null;candidateStreetIds:string[];streetId:string|null};
export default async function StreetReview({searchParams}:{searchParams:Promise<{pagina?:string;esito?:string}>}){
 await connection();const params=await searchParams,page=Math.max(1,Number(params.pagina)||1),db=await getSupabaseServerClient();
 const r=await db.from('market_observer_territorial_review').select('record_id,input_hash,references_json,human_overrides').order('record_id').range((page-1)*25,page*25-1);
 if(r.error)throw Error('Corrispondenze territoriali non disponibili');
 const cases=r.data.filter(r=>(r.references_json as Ref[]).some(a=>a.candidateStreetIds.length>1));
 const ids=cases.map(c=>c.record_id),candidateIds=[...new Set(cases.flatMap(c=>(c.references_json as Ref[]).flatMap(a=>a.candidateStreetIds)))];
 const [records,streets]=await Promise.all([ids.length?db.from('market_observer_public_records').select('id,title,source_url,content_hash').in('id',ids):Promise.resolve({data:[],error:null}),candidateIds.length?db.from('street_registry_streets').select('id,official_code,canonical_name,locality').in('id',candidateIds):Promise.resolve({data:[],error:null})]);
 if(records.error||streets.error)throw Error('Prove territoriali non disponibili');const source=new Map(records.data!.map(r=>[r.id,r])),official=new Map(streets.data!.map(s=>[s.id,s]));
 return <div className="space-y-5"><PageHeader title="Corrispondenze territoriali" description="Un nome uguale può identificare più codici ufficiali. La scelta conserva autore, data e prova; non certifica un appartamento." backHref="/fonti" backLabel="Fonti"/>
 {params.esito?<p role="status">{params.esito==='salvato'?'Decisione conservata.':'Decisione non salvata: la prova potrebbe essere cambiata. Rileggi i candidati e riprova.'}</p>:null}
 <Meta>25 casi per pagina. Sono conservate anche le corrispondenze già decise.</Meta>
 {cases.map(c=>{const record=source.get(c.record_id);return <Card key={c.record_id} className="p-4"><h2 className="font-[650]">{record?.title}</h2>{record?.content_hash!==c.input_hash?<Chip tone="warn">Prova cambiata: attendere ricalcolo</Chip>:(c.references_json as Ref[]).map((ref,index)=>ref.candidateStreetIds.length>1?<form action={decideStreet} key={index} className="mt-3 space-y-2"><p>Input: {ref.streetName} {ref.civicText??'civico non disponibile'} · {ref.locality}</p><Meta>Motivo: più ID ufficiali compatibili; nessuna identità scelta automaticamente. {c.human_overrides?.[String(index)]?.decision?`Decisione precedente: ${c.human_overrides[String(index)].decision}`:''}</Meta><input type="hidden" name="record" value={c.record_id}/><input type="hidden" name="index" value={index}/><input type="hidden" name="hash" value={c.input_hash}/><label className="block">Candidato ufficiale<select name="street" className="ml-2 max-w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] p-2"><option value="">Seleziona per confermare</option>{ref.candidateStreetIds.map(id=>{const s=official.get(id);return <option key={id} value={id}>{s?.canonical_name??id} · codice {s?.official_code} · {s?.locality??'località non dichiarata'}</option>;})}</select></label><div className="flex flex-wrap gap-2"><button className={buttonClass('secondary')} name="decision" value="SAME_STREET">Stessa strada</button><button className={buttonClass('quiet')} name="decision" value="DIFFERENT">Differente / scarta associazione</button><button className={buttonClass('quiet')} name="decision" value="UNKNOWN">Non determinabile</button></div></form>:null)}<div className="mt-3 flex gap-4"><Link className="underline" href={`/map?atto=${c.record_id}#atto`}>Prove e contesto</Link>{record?.source_url?<a className="underline" href={record.source_url} target="_blank" rel="noreferrer">Atto ufficiale</a>:null}</div></Card>;})}
 {!cases.length?<p>Nessun caso ambiguo in questa pagina dell’archivio.</p>:null}<nav className="flex justify-between">{page>1?<Link href={`?pagina=${page-1}`}>Precedenti</Link>:<span/>}{r.data.length===25?<Link href={`?pagina=${page+1}`}>Successivi</Link>:null}</nav></div>;
}

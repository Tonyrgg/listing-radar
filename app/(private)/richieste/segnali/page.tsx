import {requireUser} from '@/lib/auth';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {casePageNumber} from '@/lib/seller-intake/repository';
import {TonyBookSignals,type TonySignal} from '@/components/tonybook-signals';
export const dynamic='force-dynamic';
export const metadata={title:'Segnali TonyBook'};
export default async function TonySignals({searchParams}:{searchParams:Promise<{page?:string}>}){
 const user=await requireUser();if(!user)return <p>Accedi per consultare i segnali.</p>;
 const page=casePageNumber((await searchParams).page),db=await getSupabaseServerClient();
 const read=(p:number)=>db.from('tonybook_signals').select('id,state,signature,reference,fact,unknowns',{count:'exact'}).eq('owner_id',user.id)
  .order('updated_at',{ascending:false}).order('id',{ascending:true}).range((p-1)*50,p*50-1);
 let result=await read(page),current=page;
 if(!result.error&&page>Math.max(1,Math.ceil((result.count??0)/50))){current=Math.max(1,Math.ceil((result.count??0)/50));result=await read(current);}
 if(result.error)return <main className="max-w-[72ch] space-y-4"><h1>Segnali TonyBook</h1><p>Registro non disponibile. Verifica le migration sul database locale.</p></main>;
 return <TonyBookSignals signals={result.data as TonySignal[]} page={current} total={result.count??0}/>;
}

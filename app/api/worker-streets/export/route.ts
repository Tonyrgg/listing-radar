import {NextResponse} from 'next/server';
import * as XLSX from 'xlsx';
import {requireUser} from '@/lib/auth';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {readWorkerStreetDirectory} from '@/lib/map/worker-street-directory';
export async function GET(request:Request){
 const user=await requireUser();if(!user)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 try{
  const url=new URL(request.url),zones=url.searchParams.getAll('zona'),term=(url.searchParams.get('q')??'').trim().toLocaleLowerCase('it'),acquired=url.searchParams.get('acquisite')==='yes';
  const directory=await readWorkerStreetDirectory(getSupabaseServiceClient(),user.id);
  const rows=directory.streets.filter(s=>(!acquired||s.lastScanAt||s.count)&&(!term||`${s.name} ${s.locality} ${s.id}`.toLocaleLowerCase('it').includes(term))&&(!zones.length||zones.some(id=>id==='unlocated'?s.unlocated:id==='unassigned'?!s.unlocated&&!s.areaIds.length:s.areaIds.includes(id)))).map(s=>({'Via':s.name,'Località':s.locality,'Codice':s.id,'Zone':directory.areas.filter(a=>s.areaIds.includes(a.id)).map(a=>a.name).join(', '),'Immobili':s.count??0,'Ultima acquisizione':s.lastScanAt??'','Ricerca SISTER':s.searchText??'','Voce SISTER':s.resultName??s.sisterName}));
  const sheet=XLSX.utils.json_to_sheet(rows);sheet['!cols']=[{wch:38},{wch:18},{wch:14},{wch:35},{wch:12},{wch:26},{wch:30},{wch:38}];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Vie');
  return new Response(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="vie-per-zona.xlsx"','Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Esportazione non disponibile; riprova'},{status:503});}
}

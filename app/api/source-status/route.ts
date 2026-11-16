import {NextResponse} from 'next/server';
import {isAuthRequired} from '@/lib/auth';
import {workspaceOwner} from '@/lib/workspace-state';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {getSourcesSummary} from '@/lib/sources-health';
export const dynamic='force-dynamic';
export async function GET(){
 if(isAuthRequired()&&!await workspaceOwner())return NextResponse.json({error:'Accesso richiesto'},{status:401});
 try{
  const db=getSupabaseServiceClient();
  const [archive,agencies,privates]=await Promise.all([
   db.from('radar_read_model_state').select('source_revision,refreshed_revision,refreshed_at,last_error').single(),
   getSourcesSummary().catch(()=>({available:false,total:0,healthy:0,broken:[],partial:[],unreadListings:0})),
   db.from('private_radar_source_health').select('source,checked_at,state,discovered_count,failed_count').order('source'),
  ]);
  return NextResponse.json({checkedAt:new Date().toISOString(),archive:archive.error||!archive.data?{status:'unavailable',refreshedAt:null}:{status:archive.data.last_error?'error':archive.data.source_revision!==archive.data.refreshed_revision?'pending':'ready',refreshedAt:archive.data.refreshed_at},agencies,privates:{available:!privates.error,rows:privates.data??[]}},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Stato delle letture temporaneamente non disponibile'},{status:503});}
}

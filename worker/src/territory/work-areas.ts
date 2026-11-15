import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import type {OnlineCredentials} from './online-memory.js';
import type {StreetArea} from './zone-streets.js';
type AreasSnapshot={areas:StreetArea[];fetchedAt:string|null;stale:boolean};

/** Web drawings are authoritative, not a second editable desktop zone copy. */
export class WorkerWorkAreas{
 private cached:{areas:StreetArea[];fetchedAt:string}|null=null;
 private pending:Promise<AreasSnapshot>|null=null;
 constructor(private directory:string,private credentials?:()=>OnlineCredentials){}
 read(force=false):Promise<AreasSnapshot>{
  if(!this.pending)this.pending=this.load(force).finally(()=>{this.pending=null;});return this.pending;
 }
 private async load(force:boolean):Promise<AreasSnapshot>{
  if(!this.cached)try{this.cached=JSON.parse(await readFile(path.join(this.directory,'work-areas.json'),'utf8'));}catch(error){if(!this.credentials&&(error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Copia delle zone non leggibile');}
  if(this.credentials&&(force||!this.cached||Date.now()-Date.parse(this.cached.fetchedAt)>30000)){
   try{
    const credentials=this.credentials(),db=createClient(credentials.url,credentials.key,{auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}});
    const [areas,agents]=await Promise.all([db.from('map_areas').select('id,name,agent_id,color,geometry').order('name'),db.from('agents').select('id,name,color')]);
    if(areas.error||agents.error)throw Error('Zone online non disponibili');
    const byId=new Map(agents.data.map(a=>[a.id,a]));
    const next={fetchedAt:new Date().toISOString(),areas:areas.data.map(a=>({id:a.id,name:a.name,agentName:byId.get(a.agent_id)?.name??null,color:a.color??byId.get(a.agent_id)?.color??'#9a8ad4',geometry:a.geometry}))};
    await writeFile(path.join(this.directory,'work-areas.json.tmp'),JSON.stringify(next),{mode:0o600});await rename(path.join(this.directory,'work-areas.json.tmp'),path.join(this.directory,'work-areas.json'));this.cached=next;
   }catch(error){if(!this.cached)throw error;return{...this.cached,stale:true};}
  }
  return{...(this.cached??{areas:[],fetchedAt:null}),stale:!this.credentials};
 }
}

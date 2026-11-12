import {randomUUID} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
export function assertSynchronized(status:{pending?:boolean;conflicts?:unknown[]},error:string|null){
 if(error)throw new Error(error);
 if(status.pending)throw new Error("Modifiche locali ancora da inviare: attendi la conferma automatica prima di avviare.");
 if(status.conflicts?.length)throw new Error("Ci sono modifiche delle postazioni da confrontare: risolvile da Memoria online prima di avviare.");
}
/** Exclusive execution, kept reserved after a lost acknowledgement until this device reconciles. */
export class TerritoryOperationLease {
 private token:string|null=null;
 private timer:ReturnType<typeof setInterval>|undefined;
 private renewing=false;
 constructor(private readonly db:SupabaseClient,private readonly workspaceId:string,private readonly ownerId:string,private readonly deviceId:string){}
 private args(){return {p_workspace_id:this.workspaceId,p_owner_id:this.ownerId,p_device_id:this.deviceId,p_token:this.token};}
 async acquire(onLost:(message:string)=>void){
  if(this.token)throw new Error("Questa postazione ha una sessione da chiudere: sincronizza prima di ripartire.");
  this.token=randomUUID();
  try{
   const r=await this.db.rpc("acquire_territory_operation",this.args());
   if(r.error)throw new Error("Impossibile verificare la sessione condivisa. Controlla rete e aggiornamento Worker.");
   if(!r.data?.acquired)throw new Error(r.data?.reason??"Un altro PC sta lavorando. Attendi il salvataggio finale su quel PC.");
  }catch(error){this.token=null;throw error;}
  this.timer=setInterval(()=>{if(this.renewing)return;this.renewing=true;void this.renew().catch(error=>{this.stop();onLost(error instanceof Error?error.message:"Sessione online non confermata");}).finally(()=>{this.renewing=false;});},20000);
  this.timer.unref?.();
 }
 async renew(){const r=await this.db.rpc("renew_territory_operation",this.args());if(r.error||r.data!==true)throw new Error("Sessione condivisa non più confermata: lavorazione messa in pausa, dati locali conservati.");}
 get held(){return this.token!==null;}
 stop(){clearInterval(this.timer);this.timer=undefined;}
 async release(revision:number){
  if(!this.token)return;
  const r=await this.db.rpc("release_territory_operation",{...this.args(),p_synced_revision:revision});
  if(r.error||r.data!==true)throw new Error("Salvataggio finale della sessione non confermato: il Worker riprova automaticamente prima di liberare la postazione.");
  this.stop();this.token=null;
 }
}

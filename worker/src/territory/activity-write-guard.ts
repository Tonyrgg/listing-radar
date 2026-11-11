import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ActivityClaim,ActivityWriteGuard} from '../import-v2/activity-write-guard.js';
import type {CrmActivitySnapshot} from '../import-v2/model.js';
import {ImportV2Error} from '../import-v2/errors.js';
import type {TerritorySyncConfig} from './sync.js';

/** Shared across office/home PCs; only hashed customer identities are stored. */
export class SharedActivityWriteGuard implements ActivityWriteGuard{
  constructor(private readonly db:SupabaseClient,private readonly config:TerritorySyncConfig){}
  private async call(action:string,claim:ActivityClaim,proof?:CrmActivitySnapshot){
    const result=await this.db.rpc('territory_activity_write_guard',{
      p_workspace_id:this.config.workspaceId,p_owner_id:this.config.ownerId,
      p_client_key:createHash('sha256').update(claim.clientTaxCode.trim().toUpperCase()).digest('hex'),
      p_day:claim.day,p_operation_id:claim.operationId,p_action:action,p_proof:proof??null,
    });
    if(result.error){
      if(result.error.code==='PGRST202')throw new ImportV2Error('Il controllo condiviso delle attività richiede l’aggiornamento del database. Nessuna attività inserita.','verification_failed');
      if(['22023','42501'].includes(result.error.code))throw new ImportV2Error('Il controllo condiviso non accetta data o identità della richiesta. Verifica l’orario del PC e la configurazione; nessuna attività inserita.','verification_failed');
      throw new ImportV2Error('Il controllo condiviso delle attività non è raggiungibile. Nessun nuovo inserimento finché la verifica non riesce.','cloud_unavailable',{global:true,retryable:true});
    }
    const data=result.data as {granted:boolean;submitted:boolean;proof:CrmActivitySnapshot|null}|null;
    if(!data||typeof data.granted!=='boolean')throw new ImportV2Error('Risposta del controllo condiviso non valida','verification_failed');
    return data;
  }
  reserve(claim:ActivityClaim){return this.call('reserve',claim);}
  async submitted(claim:ActivityClaim){if(!(await this.call('submitted',claim)).granted)throw new ImportV2Error('Questo cliente è già in lavorazione su un’altra postazione. Nessun secondo inserimento.','verification_failed');}
  async confirm(claim:ActivityClaim,proof:CrmActivitySnapshot){if(!(await this.call('confirm',claim,proof)).granted)throw new ImportV2Error('La conferma condivisa dell’attività è da verificare','verification_failed');}
  async release(claim:ActivityClaim){await this.call('release',claim);}
}

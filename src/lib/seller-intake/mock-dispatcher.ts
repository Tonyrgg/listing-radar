import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
const claimSchema=z.object({id:z.uuid(),token:z.uuid(),channel:z.enum(['OPERATOR','WHATSAPP']),attempt:z.number().int().min(1).max(3),provider:z.literal('MOCK')}).strict();
/** Only a database-backed simulated transport. No message provider or contact payload is accepted. */
export async function dispatchLocalMock(db:SupabaseClient,ownerId:string,options:{mode:'local_mock';simulateFailure?:boolean;simulateLostResponse?:boolean}){
 if(options.mode!=='local_mock')throw Error('MOCK_MODE_REQUIRED');
 const claimed=await db.rpc('claim_seller_mock_delivery',{p_owner:ownerId});
 if(claimed.error)throw Error('MOCK_CLAIM_FAILED');
 if(!claimed.data)return {state:'idle' as const};
 const claim=claimSchema.parse(claimed.data);
 if(options.simulateFailure){
  const r=await db.rpc('fail_seller_mock_delivery',{p_id:claim.id,p_token:claim.token});
  if(r.error)throw Error('MOCK_RETRY_NOT_SAVED');
  return {state:'retry' as const};
 }
 const sent=await db.rpc('deliver_seller_mock',{p_id:claim.id,p_token:claim.token});
 if(sent.error)throw Error('MOCK_RESULT_UNKNOWN');
 if(options.simulateLostResponse)throw Error('LOCAL_SIMULATED_RESPONSE_LOSS');
 return {state:sent.data?'simulated_delivery':'cancelled',receiptId:sent.data as string|null};
}

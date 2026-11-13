import {assertSynchronized} from './operation-lease.js';

/** Pending is normal while a checkpoint is being acknowledged. Drain it rather
 * than turning a successful, but older, in-flight exchange into a run failure. */
export async function synchronizeUntilAcknowledged<T extends {pending?:boolean;conflicts?:unknown[]}>(
 exchange:()=>Promise<void>, status:()=>Promise<T>, error:()=>string|null,
 options:{timeoutMs?:number;delay?:()=>Promise<void>}={},
):Promise<T>{
 const deadline=Date.now()+(options.timeoutMs??60000);
 const delay=options.delay??(()=>new Promise<void>(resolve=>setTimeout(resolve,100)));
 while(true){
  await exchange();const current=await status();
  if(error())throw Error(error()!);
  if(!current.pending){assertSynchronized(current,null);return current;}
  if(Date.now()>=deadline)throw Error('La conferma online non arriva. I dati sono conservati e il Worker continua a ritentare automaticamente.');
  await delay();
 }
}

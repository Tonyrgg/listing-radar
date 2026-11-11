import type{Response}from'playwright';
/** A streaming or broken response must not hold an activity checkpoint forever. */
export async function activityResponseText(response:Response,timeoutMs=5000):Promise<string>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([response.text(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Lettura risposta attività non conclusa')),timeoutMs);timer.unref?.();})]);}
 finally{if(timer)clearTimeout(timer);}
}

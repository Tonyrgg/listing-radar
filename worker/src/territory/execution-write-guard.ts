import type {TecnocloudV2Port} from '../import-v2/ports.js';
const writes=new Set(['createPerson','overwritePerson','mergePeople','createProperty','updateProperty','replaceManagedOwnerships','ensureActivity']);
/** Recheck the central execution token even inside a long-running property workflow. */
export function guardOperationalWrites(port:TecnocloudV2Port,assertExecution:()=>Promise<void>):TecnocloudV2Port{
 return new Proxy(port,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return async(...args:unknown[])=>{if(writes.has(String(key)))await assertExecution();return Reflect.apply(value,target,args);};}});
}

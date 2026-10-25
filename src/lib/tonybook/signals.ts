import {z} from 'zod';
import {createHash} from 'node:crypto';
import {sourceReferenceSchema} from '../seller-intake/provenance';
export const tonySignalSchema=z.object({
 id:z.string().regex(/^S[0-9]{3,6}$/),state:z.enum(['ACTIVE','REJECTED','UNKNOWN']),
 reference:sourceReferenceSchema.refine(r=>r.module==='TONYBOOK'&&r.sourceType==='local_registry'),
 fact:z.string().trim().min(1).max(2000),unknowns:z.string().trim().max(2000),
}).strict().superRefine((v,ctx)=>{if(v.reference.sourceId!==v.id)ctx.addIssue({code:'custom',message:'Riferimento del segnale non coerente.'});});
export function normalizeTonySignal(input:unknown){
 const value=tonySignalSchema.parse(input);
 return {...value,signature:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
export const tonySelectionSchema=z.object({id:z.string().regex(/^S[0-9]{3,6}$/),signature:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();

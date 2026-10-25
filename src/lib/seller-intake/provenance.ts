import {z} from 'zod';
export const MODULE_LABELS={WORKER:'Worker',RADAR:'Listing Radar',TONYBOOK:'TonyBook',VAB:'Vendere a Bitonto'} as const;
const publicUrl=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;},'Usa un collegamento pubblico HTTPS.');
const sourceDate=z.union([z.iso.date(),z.string().datetime({offset:true})]);
export const sourceReferenceSchema=z.object({
 module:z.enum(['WORKER','RADAR','TONYBOOK','VAB']),
 sourceType:z.enum(['worker_import','public_news','local_registry','meta_form','local_test']),
 sourceId:z.string().regex(/^[A-Za-z0-9:._/-]{1,200}$/),
 sourceUrl:publicUrl.nullable(),
 observedAt:sourceDate,
 publishedAt:sourceDate.nullable(),
 evidenceSignature:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((v,ctx)=>{
 const allowed={WORKER:['worker_import'],RADAR:['public_news'],TONYBOOK:['local_registry'],VAB:['meta_form','local_test']};
 if(!allowed[v.module].includes(v.sourceType))ctx.addIssue({code:'custom',message:'Modulo e tipo di fonte non coerenti.'});
});
export type SourceReference=z.infer<typeof sourceReferenceSchema>;
export const attachSourceSchema=z.object({caseId:z.uuid(),reference:sourceReferenceSchema}).strict();
export const linkPropertySchema=z.object({caseId:z.uuid(),propertyId:z.uuid(),note:z.string().trim().min(1).max(2000)}).strict();

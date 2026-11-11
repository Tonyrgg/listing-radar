import {z} from 'zod';

const position=z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]);
const ring=z.array(position).min(4).max(2000).superRefine((points,ctx)=>{
  const first=points[0],last=points.at(-1)!;
  if(first[0]!==last[0]||first[1]!==last[1])ctx.addIssue({code:'custom',message:'Chiudi il perimetro tornando al primo punto.'});
  const area=points.slice(1).reduce((sum,p,i)=>sum+points[i][0]*p[1]-p[0]*points[i][1],0);
  if(Math.abs(area)<1e-12)ctx.addIssue({code:'custom',message:'Disegna una zona con almeno tre punti distinti e una superficie.'});
});
export const workAreaInput=z.object({
  id:z.uuid().optional(),
  creationId:z.uuid().optional(),
  expectedUpdatedAt:z.string().datetime({offset:true}).nullable().optional(),
  name:z.string().trim().min(1,'Inserisci il nome della zona.').max(160),
  agentId:z.uuid().nullable(),
  color:z.string().regex(/^#[0-9a-f]{6}$/i,'Scegli un colore valido.'),
  geometry:z.object({type:z.literal('Polygon'),coordinates:z.array(ring).min(1).max(8)}),
}).superRefine((value,ctx)=>{
  if(value.id&&value.expectedUpdatedAt===undefined)ctx.addIssue({code:'custom',path:['expectedUpdatedAt'],message:'Ricarica la zona prima di modificarla.'});
  if(!value.id&&!value.creationId)ctx.addIssue({code:'custom',path:['creationId'],message:'Riapri il disegno prima di creare la zona.'});
});

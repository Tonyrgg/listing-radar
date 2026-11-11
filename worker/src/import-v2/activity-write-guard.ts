import type {CrmActivitySnapshot} from './model.js';
export type ActivityClaim={clientTaxCode:string;day:string;operationId:string};
export interface ActivityWriteGuard{
  reserve(claim:ActivityClaim):Promise<{granted:boolean;submitted:boolean;proof:CrmActivitySnapshot|null}>;
  submitted(claim:ActivityClaim):Promise<void>;
  confirm(claim:ActivityClaim,proof:CrmActivitySnapshot):Promise<void>;
  release(claim:ActivityClaim):Promise<void>;
}

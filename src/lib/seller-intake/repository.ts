import type { SupabaseClient } from '@supabase/supabase-js';
import type { ACTIONS, CASE_STATUSES, InboundSubmission } from './model';
import type {SourceReference} from './provenance';
export interface SellerCase {
  id: string; kind: 'INBOUND' | 'VERIFICATION'; title: string;
  status: keyof typeof CASE_STATUSES; next_action: keyof typeof ACTIONS;
  next_action_at: string | null; revision: number; created_at: string;
  submission: Partial<InboundSubmission> & { sourceUrl?: string; candidateId?: string; unknown?: string; fact?:string };
  seller_case_history: { revision: number; note: string; status: string; created_at: string }[];
  seller_delivery_outbox: { channel: string; status: string;provider?:'MOCK' }[];
  seller_case_sources?: {reference:SourceReference;created_at:string}[];
  seller_case_property_links?: {property_id:string;note:string}[];
}
export interface SellerCasePage {items:SellerCase[];total:number;page:number;pageSize:number;hasNext:boolean}
export const CASE_PAGE_SIZE=50;
export function casePageNumber(value: unknown): number {
  const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=1_000_000?n:1;
}
export async function readSellerCases(db: SupabaseClient, ownerId: string, closed = false, requestedPage: unknown = 1): Promise<SellerCasePage> {
  const read = async (page:number) => {
    let query=db.from('seller_cases')
      .select('id,kind,title,status,next_action,next_action_at,revision,created_at,submission,seller_case_history(revision,note,status,created_at),seller_delivery_outbox(channel,status,provider),seller_case_sources(reference,created_at),seller_case_property_links(property_id,note)',{count:'exact'})
      .eq('owner_id',ownerId).order('next_action_at',{ascending:true,nullsFirst:false}).order('id',{ascending:true})
      .range((page-1)*CASE_PAGE_SIZE,page*CASE_PAGE_SIZE-1);
    query=closed?query.in('status',['CLOSED','MANDATE','DO_NOT_CONTACT']):query.not('status','in','(CLOSED,MANDATE,DO_NOT_CONTACT)');
    const result=await query;
    if(result.error||result.count===null)throw Error('Coda non disponibile. Verifica le migration sul database locale.');
    return result;
  };
  let page=casePageNumber(requestedPage), result=await read(page);
  const lastPage=Math.max(1,Math.ceil(result.count!/CASE_PAGE_SIZE));
  if(page>lastPage){page=lastPage;result=await read(page);}
  return {items:result.data as unknown as SellerCase[],total:result.count!,page,pageSize:CASE_PAGE_SIZE,hasNext:page*CASE_PAGE_SIZE<result.count!};
}

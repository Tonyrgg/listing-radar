import { describe, expect, it, vi, beforeEach } from 'vitest';
import { inboundSchema, reviewSchema } from '@/lib/seller-intake/model';
import { intakeAuthorized, localIntakeReady } from '@/lib/seller-intake/local-gate';
import { ingestSellerSubmission } from '@/lib/seller-intake/ingest';
import { POST } from '../app/api/seller-intake/route';
import type { SupabaseClient } from '@supabase/supabase-js';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/service', () => ({ getSupabaseServiceClient: () => ({ rpc }) }));
export const sample = {
  externalId:'local-001',formVersion:'seller_v1',name:'Persona di prova',phone:'+39 000 000 0000',
  answers:{situation:'considering_sale',role:'owner',locality:'Bitonto',propertyType:'apartment',timing:'undecided'},
  callbackRequested:true,whatsappOptIn:false,privacyVersion:'LOCAL_TEST_NOT_FOR_PUBLIC_USE',attribution:{source:'local_test'},
};
beforeEach(() => {
  vi.unstubAllEnvs(); rpc.mockReset();
  vi.stubEnv('SELLER_INTAKE_LOCAL_ENABLED','true'); vi.stubEnv('NODE_ENV','test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:54321');
  vi.stubEnv('SELLER_INTAKE_OWNER_ID','10000000-0000-4000-8000-000000000001');
  vi.stubEnv('SELLER_INTAKE_TOKEN','local-test-secret-at-least-32-characters');
});
const request = (body: unknown, token = process.env.SELLER_INTAKE_TOKEN) => new Request('http://localhost/api/seller-intake', {
  method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body),
});
describe('seller intake trust and consent boundary', () => {
  it('normalizes a phone but never upgrades role or consent', () => {
    const v = inboundSchema.parse(sample); expect(v.phone).toBe('+390000000000'); expect(v.whatsappOptIn).toBe(false);
    expect(inboundSchema.safeParse({...sample,callbackRequested:false}).success).toBe(false);
    expect(inboundSchema.safeParse({...sample,ownerId:'attacker'}).success).toBe(false);
    expect(inboundSchema.safeParse({...sample,answers:{...sample.answers,locality:'Bari'}}).success).toBe(false);
    expect(inboundSchema.safeParse({...sample,attribution:{source:'local_test',adId:'email@example.org'}}).success).toBe(false);
  });
  it('cannot enable production or a remote database, even with flags', () => {
    expect(localIntakeReady()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://production.supabase.co'); expect(localIntakeReady()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost.evil.example'); expect(localIntakeReady()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost:54321'); vi.stubEnv('NODE_ENV','production'); expect(localIntakeReady()).toBe(false);
    expect(intakeAuthorized('Bearer wrong','right')).toBe(false);
  });
  it('hashes normalized content deterministically and does not leak provider errors', async () => {
    rpc.mockResolvedValue({data:{id:'case',duplicate:false},error:null});
    const db = {rpc} as unknown as SupabaseClient;
    await ingestSellerSubmission(db,'owner',sample); const first=rpc.mock.calls[0][1];
    await ingestSellerSubmission(db,'owner',{...sample,phone:'+390000000000'});
    expect(rpc.mock.calls[1][1].p_signature).toBe(first.p_signature);
    rpc.mockResolvedValue({data:null,error:{message:'secret phone and token'}});
    await expect(ingestSellerSubmission(db,'owner',sample)).rejects.toThrow('INTAKE_PERSISTENCE_FAILED');
  });
  it('rejects unauthorized, oversized, malformed and disabled requests before DB access', async () => {
    expect((await POST(request(sample,'wrong'))).status).toBe(401);
    expect((await POST(request({text:'x'.repeat(12001)}))).status).toBe(413);
    expect((await POST(request({...sample,phone:'bad'}))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    vi.stubEnv('SELLER_INTAKE_LOCAL_ENABLED','false'); expect((await POST(request(sample))).status).toBe(503);
  });
  it('returns receipt only after durable success; failure is retryable with the same id', async () => {
    rpc.mockResolvedValue({data:null,error:{message:'private error'}});
    const failed=await POST(request(sample)); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain('private error');
    rpc.mockResolvedValue({data:{id:'case',duplicate:false},error:null}); expect((await POST(request(sample))).status).toBe(201);
    rpc.mockResolvedValue({data:{id:'case',duplicate:true},error:null}); expect((await POST(request(sample))).status).toBe(200);
    rpc.mockResolvedValue({data:null,error:{code:'23505'}}); expect((await POST(request(sample))).status).toBe(409);
  });
  it('requires a next action and outcome, and removes callbacks for closed cases', () => {
    const base={id:'10000000-0000-4000-8000-000000000001',revision:0,status:'TO_CALL',nextAction:'CALL',nextActionAt:null,note:'Da verificare'};
    expect(reviewSchema.safeParse(base).success).toBe(false);
    expect(reviewSchema.safeParse({...base,nextActionAt:'2026-10-26T10:00:00+01:00'}).success).toBe(true);
    expect(reviewSchema.safeParse({...base,status:'DO_NOT_CONTACT',nextAction:'NONE'}).success).toBe(true);
    expect(reviewSchema.safeParse({...base,status:'CLOSED',nextActionAt:'2026-10-26T10:00:00Z'}).success).toBe(false);
  });
});

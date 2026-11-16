import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({owner:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/workspace-state',()=>({workspaceOwner:mocks.owner}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseServiceClient:()=>({})}));
vi.mock('@/lib/property-lifecycle/read-models/saved-snapshots',()=>({readSavedSnapshots:mocks.read}));
import {GET} from '../../app/api/properties/[id]/snapshots/route';
const id='11111111-1111-4111-8111-111111111111';
describe('saved snapshots API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.owner.mockResolvedValue('user');});
 it('requires account authentication before reading history',async()=>{mocks.owner.mockResolvedValue(null);expect((await GET(new Request('https://example.org'),{params:Promise.resolve({id})})).status).toBe(401);expect(mocks.read).not.toHaveBeenCalled();});
 it('validates IDs and returns a private uncached snapshot',async()=>{expect((await GET(new Request('https://example.org'),{params:Promise.resolve({id:'bad'})})).status).toBe(400);mocks.read.mockResolvedValue([{publicationId:'removed',snapshot:{normalized_payload:{commercial:{description:'Retained'}}}}]);const r=await GET(new Request('https://example.org'),{params:Promise.resolve({id})});expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect((await r.json()).publications[0].snapshot.normalized_payload.commercial.description).toBe('Retained');});
 it('reports a read failure instead of declaring an empty archive',async()=>{mocks.read.mockRejectedValue(Error('timeout'));expect((await GET(new Request('https://example.org'),{params:Promise.resolve({id})})).status).toBe(503);});
});

import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({sources:vi.fn()}));
vi.mock('@/lib/auth',()=>({isAuthRequired:()=>false}));
vi.mock('@/lib/workspace-state',()=>({workspaceOwner:async()=>null}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseServiceClient:()=>({from:()=>({select:()=>({single:async()=>({data:{source_revision:2,refreshed_revision:2,refreshed_at:'2026-11-11T20:00:00Z',last_error:null},error:null}),order:async()=>({data:[],error:null})})})})}));
vi.mock('@/lib/sources-health',()=>({getSourcesSummary:mocks.sources}));
import {GET} from '../../app/api/source-status/route';
it('does not confuse a freshly rebuilt archive with successfully read portals',async()=>{
 mocks.sources.mockResolvedValue({available:true,total:9,healthy:8,broken:[{name:'Fonte non disponibile',note:'non ha risposto'}],partial:[]});
 const data=await(await GET()).json();
 expect(data.archive.status).toBe('ready');expect(data.agencies.healthy).toBe(8);expect(data.agencies.broken[0].name).toBe('Fonte non disponibile');
});
it('keeps unreadable source status distinct from a healthy archive',async()=>{
 mocks.sources.mockResolvedValue({available:false,healthy:0,broken:[],partial:[]});
 const data=await(await GET()).json();expect(data.archive.status).toBe('ready');expect(data.agencies.available).toBe(false);expect(data.agencies.healthy).toBe(0);
});

import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({owner:vi.fn(),prefs:vi.fn(),snapshot:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/workspace-state',()=>({workspaceOwner:mocks.owner,readWorkspacePreferences:mocks.prefs,latestWorkspaceSnapshot:mocks.snapshot,noticeTabs:['mercato','opportunita','privati','usciti','notizie']}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseServiceClient:()=>({from:()=>({upsert:mocks.upsert})})}));
import {GET,POST} from '../app/api/workspace-state/route';
const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',property='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
beforeEach(()=>{vi.clearAllMocks();mocks.owner.mockResolvedValue(owner);mocks.prefs.mockResolvedValue([]);mocks.snapshot.mockResolvedValue({mercato:{[property]:'version2'},opportunita:{},privati:{},usciti:{},notizie:{}});mocks.upsert.mockResolvedValue({error:null});});
const request=(body:unknown,origin='http://localhost')=>new Request('http://localhost/api/workspace-state',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
it('distinguishes unread new records, updates and an individually acknowledged version',async()=>{
 let data=await (await GET()).json();expect(data.notices.mercato[property]).toBe('new');
 mocks.prefs.mockResolvedValue([{key:`workspace:${owner}:read:mercato`,value:{[property]:'version1'}}]);data=await (await GET()).json();expect(data.notices.mercato[property]).toBe('updated');
 mocks.prefs.mockResolvedValue([{key:`workspace:${owner}:record:mercato:${property}`,value:'version2'}]);data=await (await GET()).json();expect(data.notices.mercato).toEqual({});
});
it('saves the authenticated account favorite and ignores a supplied different owner',async()=>{
 expect((await POST(request({action:'favorite',id:property,active:true,owner:'other'}))).status).toBe(200);
 expect(mocks.upsert).toHaveBeenCalledWith({key:`workspace:${owner}:favorite:${property}`,value:true},{onConflict:'key'});
});
it('rejects unauthenticated changes and cross origin writes',async()=>{
 mocks.owner.mockResolvedValue(null);expect((await POST(request({action:'favorite',id:property,active:true}))).status).toBe(401);
 mocks.owner.mockResolvedValue(owner);expect((await POST(request({action:'favorite',id:property,active:true},'https://evil.example'))).status).toBe(403);expect(mocks.upsert).not.toHaveBeenCalled();
});
it('acknowledges the actual current record version and rejects absent records',async()=>{
 expect((await POST(request({action:'read',tab:'mercato',id:property}))).status).toBe(200);expect(mocks.upsert).toHaveBeenCalledWith({key:`workspace:${owner}:record:mercato:${property}`,value:'version2'},{onConflict:'key'});
 expect((await POST(request({action:'read',tab:'mercato',id:'absent'}))).status).toBe(409);
});

it('returns authentication required rather than a false database outage for anonymous notification reads',async()=>{mocks.owner.mockResolvedValue(null);expect((await GET()).status).toBe(401);expect(mocks.snapshot).not.toHaveBeenCalled();});

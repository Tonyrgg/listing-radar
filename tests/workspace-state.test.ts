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

it('returns a field recap for updated properties',async()=>{
 mocks.snapshot.mockResolvedValue({mercato:{[property]:{hash:'v2',fields:{latest_asking_price:120000}}},opportunita:{},privati:{},usciti:{},notizie:{}});
 mocks.prefs.mockResolvedValue([{key:`workspace:${owner}:record:mercato:${property}`,value:{hash:'v1',fields:{latest_asking_price:130000}}}]);
 const data=await(await GET()).json();expect(data.notices.mercato[property]).toBe('updated');expect(data.updates.mercato[property].changes[0]).toMatchObject({field:'latest_asking_price',before:130000,after:120000});
});
it('acknowledges a property across all its views and rejects a stale displayed version',async()=>{
 const version={hash:'v2',fields:{latest_asking_price:120000}};mocks.snapshot.mockResolvedValue({mercato:{[property]:version},opportunita:{[property]:version},privati:{},usciti:{},notizie:{}});
 expect((await POST(request({action:'read-property',id:property,tab:'mercato',expectedHash:'v1'}))).status).toBe(409);expect(mocks.upsert).not.toHaveBeenCalled();
 expect((await POST(request({action:'read-property',id:property,tab:'mercato',expectedHash:'v2'}))).status).toBe(200);expect(mocks.upsert).toHaveBeenCalledWith([{key:`workspace:${owner}:record:mercato:${property}`,value:version},{key:`workspace:${owner}:record:opportunita:${property}`,value:version}],{onConflict:'key'});
});
